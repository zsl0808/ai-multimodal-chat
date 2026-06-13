package com.ai.conversation.handler;

import com.ai.conversation.config.AppConfig;
import com.ai.conversation.model.ChatMessage;
import com.ai.conversation.model.ConversationSession;
import com.ai.conversation.service.GeminiAIService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.AbstractWebSocketHandler;

import java.io.IOException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 多模态 WebSocket 处理器
 *
 * 处理来自浏览器的:
 * - 文字消息 (JSON)
 * - 图像帧 (二进制 JPEG)
 * - 控制指令 (JSON)
 *
 * 成本控制: 自适应帧率 - 只在画面变化时处理帧
 */
@Component
public class MultimodalWebSocketHandler extends AbstractWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(MultimodalWebSocketHandler.class);

    private final GeminiAIService geminiService;
    private final AppConfig appConfig;
    private final ObjectMapper objectMapper;
    private final ConcurrentHashMap<String, ConversationSession> sessions;
    private final ExecutorService executorService;

    // Frame deduplication: minimum interval between frame processing (ms)
    private static final long MIN_FRAME_INTERVAL_MS = 5000;

    public MultimodalWebSocketHandler(GeminiAIService geminiService, AppConfig appConfig) {
        this.geminiService = geminiService;
        this.appConfig = appConfig;
        this.objectMapper = new ObjectMapper();
        this.sessions = new ConcurrentHashMap<>();
        this.executorService = Executors.newCachedThreadPool();
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        String sessionId = session.getId();
        sessions.put(sessionId, new ConversationSession(sessionId));
        log.info("WebSocket connected: {}", sessionId);

        // Send welcome message
        sendMessage(session, ChatMessage.status("连接成功！你可以开始与 AI 对话了。"));
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        String payload = message.getPayload();
        log.debug("Received text message from {}: {}", session.getId(), payload);

        try {
            ChatMessage chatMessage = objectMapper.readValue(payload, ChatMessage.class);
            ConversationSession convSession = sessions.get(session.getId());

            if (convSession == null) {
                sendMessage(session, ChatMessage.error("会话不存在，请重新连接"));
                return;
            }

            switch (chatMessage.getType()) {
                case TEXT -> handleTextChat(session, convSession, chatMessage);
                case CONTROL -> handleControl(session, convSession, chatMessage);
                default -> log.warn("Unknown message type: {}", chatMessage.getType());
            }
        } catch (Exception e) {
            log.error("Failed to process text message", e);
            sendMessage(session, ChatMessage.error("消息处理失败: " + e.getMessage()));
        }
    }

    @Override
    protected void handleBinaryMessage(WebSocketSession session, BinaryMessage message) throws Exception {
        ConversationSession convSession = sessions.get(session.getId());
        if (convSession == null) {
            return;
        }

        byte[] frameData = message.getPayload().array();

        // Cost control: skip frame if too soon since last processing
        if (!convSession.shouldProcessFrame(MIN_FRAME_INTERVAL_MS)) {
            log.debug("Skipping frame - too soon since last processing");
            return;
        }

        convSession.updateFrame(frameData);
        log.info("Processing image frame from {}, size: {} bytes", session.getId(), frameData.length);

        // Process image asynchronously
        sendMessage(session, ChatMessage.status("正在分析画面..."));

        executorService.submit(() -> {
            try {
                String response = geminiService.analyzeImage(convSession, frameData);
                sendMessage(session, ChatMessage.assistantText(response));
            } catch (Exception e) {
                log.error("Failed to process image", e);
                try {
                    sendMessage(session, ChatMessage.error("图像分析失败: " + e.getMessage()));
                } catch (IOException ex) {
                    log.error("Failed to send error message", ex);
                }
            }
        });
    }

    /**
     * 处理文字聊天消息
     */
    private void handleTextChat(WebSocketSession session, ConversationSession convSession, ChatMessage message) {
        String userText = message.getContent();
        if (userText == null || userText.isBlank()) {
            return;
        }

        log.info("User [{}]: {}", session.getId(), userText);

        // If camera is active and we have a recent frame, send multimodal request
        byte[] lastFrame = convSession.getLastFrame();

        executorService.submit(() -> {
            try {
                sendMessage(session, ChatMessage.status("AI 思考中..."));

                String response;
                if (convSession.isCameraActive() && lastFrame != null) {
                    // Multimodal: text + last video frame
                    response = geminiService.chatWithImage(convSession, userText, lastFrame);
                } else {
                    // Text only
                    response = geminiService.chat(convSession, userText);
                }

                log.info("AI [{}]: {}", session.getId(), response);
                sendMessage(session, ChatMessage.assistantText(response));
            } catch (Exception e) {
                log.error("Chat processing failed", e);
                try {
                    sendMessage(session, ChatMessage.error("处理失败: " + e.getMessage()));
                } catch (IOException ex) {
                    log.error("Failed to send error", ex);
                }
            }
        });
    }

    /**
     * 处理控制指令
     */
    private void handleControl(WebSocketSession session, ConversationSession convSession, ChatMessage message) throws IOException {
        String action = message.getAction();
        if (action == null) return;

        switch (action) {
            case "start_camera" -> {
                convSession.setCameraActive(true);
                sendMessage(session, ChatMessage.status("摄像头已开启，AI 现在可以看到画面"));
                log.info("Camera started for session: {}", session.getId());
            }
            case "stop_camera" -> {
                convSession.setCameraActive(false);
                sendMessage(session, ChatMessage.status("摄像头已关闭"));
                log.info("Camera stopped for session: {}", session.getId());
            }
            case "clear_history" -> {
                convSession.clearHistory();
                sendMessage(session, ChatMessage.status("对话历史已清除"));
                log.info("History cleared for session: {}", session.getId());
            }
            default -> log.warn("Unknown control action: {}", action);
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        String sessionId = session.getId();
        sessions.remove(sessionId);
        log.info("WebSocket disconnected: {}, status: {}", sessionId, status);
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) {
        log.error("Transport error for session: {}", session.getId(), exception);
        sessions.remove(session.getId());
    }

    /**
     * 发送 JSON 消息到客户端
     */
    private void sendMessage(WebSocketSession session, ChatMessage message) throws IOException {
        if (session.isOpen()) {
            String json = objectMapper.writeValueAsString(message);
            session.sendMessage(new TextMessage(json));
        }
    }
}

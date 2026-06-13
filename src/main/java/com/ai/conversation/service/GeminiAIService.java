package com.ai.conversation.service;

import com.ai.conversation.config.AppConfig;
import com.ai.conversation.model.ChatMessage;
import com.ai.conversation.model.ConversationSession;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import okhttp3.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.util.Base64;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * Gemini AI 服务 - 负责调用 Google Gemini API 处理多模态请求
 *
 * 成本控制策略:
 * 1. 使用最便宜的 gemini-2.0-flash 模型
 * 2. 限制输出 token 数量 (maxOutputTokens)
 * 3. 只保留最近 N 轮对话上下文
 * 4. 图像使用 JPEG 压缩 (质量由前端控制)
 */
@Service
public class GeminiAIService {

    private static final Logger log = LoggerFactory.getLogger(GeminiAIService.class);

    private final AppConfig appConfig;
    private final OkHttpClient httpClient;
    private final ObjectMapper objectMapper;

    // System prompt that instructs the AI how to behave
    private static final String SYSTEM_PROMPT =
            "你是一个友好的 AI 助手，能够通过摄像头看到用户的画面，通过语音与用户交流。" +
            "请用简洁、自然的中文回复。如果用户发送了图像，请描述你看到的内容。" +
            "回复控制在 200 字以内，保持对话的自然流畅。";

    public GeminiAIService(AppConfig appConfig) {
        this.appConfig = appConfig;
        this.objectMapper = new ObjectMapper();
        this.httpClient = new OkHttpClient.Builder()
                .connectTimeout(30, TimeUnit.SECONDS)
                .readTimeout(60, TimeUnit.SECONDS)
                .writeTimeout(30, TimeUnit.SECONDS)
                .build();
    }

    /**
     * 发送文字消息给 Gemini API
     */
    public String chat(ConversationSession session, String userMessage) {
        // 记录用户消息
        session.addMessage(ChatMessage.userText(userMessage));

        try {
            String requestBody = buildTextRequest(session, userMessage);
            String response = callGeminiApi(requestBody);

            // 记录 AI 回复
            session.addMessage(ChatMessage.assistantText(response));
            return response;
        } catch (Exception e) {
            log.error("Gemini API call failed", e);
            return "抱歉，AI 服务暂时不可用，请稍后再试。错误: " + e.getMessage();
        }
    }

    /**
     * 发送图像 + 文字给 Gemini API (多模态)
     */
    public String chatWithImage(ConversationSession session, String userMessage, byte[] imageData) {
        // 记录用户消息 (图像不存入历史，只存文字描述)
        session.addMessage(ChatMessage.userText(userMessage + " [附带摄像头画面]"));

        try {
            String requestBody = buildMultimodalRequest(session, userMessage, imageData);
            String response = callGeminiApi(requestBody);

            session.addMessage(ChatMessage.assistantText(response));
            return response;
        } catch (Exception e) {
            log.error("Gemini multimodal API call failed", e);
            return "抱歉，图像分析服务暂时不可用。错误: " + e.getMessage();
        }
    }

    /**
     * 分析图像 (无文字提问，纯画面描述)
     */
    public String analyzeImage(ConversationSession session, byte[] imageData) {
        return chatWithImage(session, "请简要描述你在这张图像中看到的内容。", imageData);
    }

    /**
     * 构建纯文字请求体
     */
    private String buildTextRequest(ConversationSession session, String userMessage) {
        try {
            ObjectNode root = objectMapper.createObjectNode();

            // System instruction
            ObjectNode systemInstruction = root.putObject("systemInstruction");
            ArrayNode systemParts = systemInstruction.putArray("parts");
            systemParts.addObject().put("text", SYSTEM_PROMPT);

            // Contents (conversation history)
            ArrayNode contents = root.putArray("contents");
            List<ChatMessage> recentHistory = session.getRecentHistory(appConfig.getMaxContextRounds());

            for (ChatMessage msg : recentHistory) {
                ObjectNode content = contents.addObject();
                content.put("role", msg.getRole() == ChatMessage.Role.USER ? "user" : "model");
                ArrayNode parts = content.putArray("parts");
                parts.addObject().put("text", msg.getContent());
            }

            // Generation config
            ObjectNode genConfig = root.putObject("generationConfig");
            genConfig.put("maxOutputTokens", appConfig.getMaxOutputTokens());
            genConfig.put("temperature", appConfig.getTemperature());

            return objectMapper.writeValueAsString(root);
        } catch (Exception e) {
            throw new RuntimeException("Failed to build request", e);
        }
    }

    /**
     * 构建多模态请求体 (图像 + 文字)
     */
    private String buildMultimodalRequest(ConversationSession session, String userMessage, byte[] imageData) {
        try {
            ObjectNode root = objectMapper.createObjectNode();

            // System instruction
            ObjectNode systemInstruction = root.putObject("systemInstruction");
            ArrayNode systemParts = systemInstruction.putArray("parts");
            systemParts.addObject().put("text", SYSTEM_PROMPT);

            // Contents
            ArrayNode contents = root.putArray("contents");

            // Add conversation history (text only, to save tokens)
            List<ChatMessage> recentHistory = session.getRecentHistory(appConfig.getMaxContextRounds());
            for (ChatMessage msg : recentHistory) {
                // Skip the last user message as we'll add it with the image
                if (msg == recentHistory.get(recentHistory.size() - 1) && msg.getRole() == ChatMessage.Role.USER) {
                    continue;
                }
                ObjectNode content = contents.addObject();
                content.put("role", msg.getRole() == ChatMessage.Role.USER ? "user" : "model");
                ArrayNode parts = content.putArray("parts");
                parts.addObject().put("text", msg.getContent());
            }

            // Add current user message with image
            ObjectNode userContent = contents.addObject();
            userContent.put("role", "user");
            ArrayNode userParts = userContent.putArray("parts");

            // Text part
            userParts.addObject().put("text", userMessage);

            // Image part
            ObjectNode imagePart = userParts.addObject();
            ObjectNode inlineData = imagePart.putObject("inlineData");
            inlineData.put("mimeType", "image/jpeg");
            inlineData.put("data", Base64.getEncoder().encodeToString(imageData));

            // Generation config
            ObjectNode genConfig = root.putObject("generationConfig");
            genConfig.put("maxOutputTokens", appConfig.getMaxOutputTokens());
            genConfig.put("temperature", appConfig.getTemperature());

            return objectMapper.writeValueAsString(root);
        } catch (Exception e) {
            throw new RuntimeException("Failed to build multimodal request", e);
        }
    }

    /**
     * 调用 Gemini REST API
     */
    private String callGeminiApi(String requestBody) throws IOException {
        String url = String.format("%s/models/%s:generateContent?key=%s",
                appConfig.getGeminiBaseUrl(),
                appConfig.getGeminiModel(),
                appConfig.getGeminiApiKey());

        Request request = new Request.Builder()
                .url(url)
                .post(RequestBody.create(requestBody, MediaType.parse("application/json")))
                .build();

        log.debug("Calling Gemini API: {}", url.replace(appConfig.getGeminiApiKey(), "***"));

        try (Response response = httpClient.newCall(request).execute()) {
            String body = response.body() != null ? response.body().string() : "";

            if (!response.isSuccessful()) {
                log.error("Gemini API error: {} - {}", response.code(), body);
                throw new IOException("Gemini API returned " + response.code() + ": " + body);
            }

            return extractResponseText(body);
        }
    }

    /**
     * 从 Gemini API 响应中提取文本
     */
    private String extractResponseText(String responseBody) throws IOException {
        JsonNode root = objectMapper.readTree(responseBody);

        JsonNode candidates = root.get("candidates");
        if (candidates != null && candidates.isArray() && !candidates.isEmpty()) {
            JsonNode content = candidates.get(0).get("content");
            if (content != null) {
                JsonNode parts = content.get("parts");
                if (parts != null && parts.isArray() && !parts.isEmpty()) {
                    StringBuilder sb = new StringBuilder();
                    for (JsonNode part : parts) {
                        JsonNode text = part.get("text");
                        if (text != null) {
                            sb.append(text.asText());
                        }
                    }
                    return sb.toString();
                }
            }
        }

        // Fallback: try to extract any text from the response
        log.warn("Unexpected Gemini response structure: {}", responseBody);
        return "AI 未能生成有效回复，请重试。";
    }
}

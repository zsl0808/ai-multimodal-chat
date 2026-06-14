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
 * AI 服务 - 负责调用通义千问 VL API 处理多模态请求
 *
 * 使用 DashScope OpenAI 兼容模式:
 * - 端点: https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
 * - 模型: qwen-vl-max (视觉语言大模型)
 * - 认证: Bearer Token
 *
 * 成本控制策略:
 * 1. 使用 qwen-vl-max 模型（性价比高）
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
     * 发送文字消息
     */
    public String chat(ConversationSession session, String userMessage) {
        session.addMessage(ChatMessage.userText(userMessage));

        try {
            String requestBody = buildTextRequest(session);
            String response = callQwenApi(requestBody);
            session.addMessage(ChatMessage.assistantText(response));
            return response;
        } catch (Exception e) {
            log.error("Qwen API call failed", e);
            return "抱歉，AI 服务暂时不可用，请稍后再试。错误: " + e.getMessage();
        }
    }

    /**
     * 发送图像 + 文字 (多模态)
     */
    public String chatWithImage(ConversationSession session, String userMessage, byte[] imageData) {
        session.addMessage(ChatMessage.userText(userMessage + " [附带摄像头画面]"));

        try {
            String requestBody = buildMultimodalRequest(session, userMessage, imageData);
            String response = callQwenVLApi(requestBody);
            session.addMessage(ChatMessage.assistantText(response));
            return response;
        } catch (Exception e) {
            log.error("Qwen multimodal API call failed", e);
            return "抱歉，图像分析服务暂时不可用。错误: " + e.getMessage();
        }
    }

    /**
     * 分析图像 (纯画面描述)
     */
    public String analyzeImage(ConversationSession session, byte[] imageData) {
        return chatWithImage(session, "请简要描述你在这张图像中看到的内容。", imageData);
    }

    /**
     * 构建纯文字请求体 (DashScope 原生格式)
     */
    private String buildTextRequest(ConversationSession session) {
        try {
            ObjectNode root = objectMapper.createObjectNode();
            root.put("model", "qwen-turbo");

            // Input
            ObjectNode input = root.putObject("input");

            // Messages
            ArrayNode messages = input.putArray("messages");

            // System message
            ObjectNode sysMsg = messages.addObject();
            sysMsg.put("role", "system");
            sysMsg.put("content", SYSTEM_PROMPT);

            // Conversation history
            List<ChatMessage> recentHistory = session.getRecentHistory(appConfig.getMaxContextRounds());
            for (ChatMessage msg : recentHistory) {
                ObjectNode chatMsg = messages.addObject();
                chatMsg.put("role", msg.getRole() == ChatMessage.Role.USER ? "user" : "assistant");
                chatMsg.put("content", msg.getContent());
            }

            // Parameters
            ObjectNode parameters = root.putObject("parameters");
            parameters.put("max_tokens", appConfig.getMaxOutputTokens());
            parameters.put("temperature", appConfig.getTemperature());

            return objectMapper.writeValueAsString(root);
        } catch (Exception e) {
            throw new RuntimeException("Failed to build request", e);
        }
    }

    /**
     * 构建多模态请求体 (图像 + 文字) - DashScope 原生格式
     */
    private String buildMultimodalRequest(ConversationSession session, String userMessage, byte[] imageData) {
        try {
            ObjectNode root = objectMapper.createObjectNode();
            root.put("model", "qwen-vl-max");

            // Input
            ObjectNode input = root.putObject("input");

            // Messages
            ArrayNode messages = input.putArray("messages");

            // System message
            ObjectNode sysMsg = messages.addObject();
            sysMsg.put("role", "system");
            sysMsg.put("content", SYSTEM_PROMPT);

            // Conversation history (text only)
            List<ChatMessage> recentHistory = session.getRecentHistory(appConfig.getMaxContextRounds());
            for (ChatMessage msg : recentHistory) {
                if (msg == recentHistory.get(recentHistory.size() - 1) && msg.getRole() == ChatMessage.Role.USER) {
                    continue;
                }
                ObjectNode chatMsg = messages.addObject();
                chatMsg.put("role", msg.getRole() == ChatMessage.Role.USER ? "user" : "assistant");
                chatMsg.put("content", msg.getContent());
            }

            // Current user message with image (DashScope multimodal format)
            ObjectNode userMsg = messages.addObject();
            userMsg.put("role", "user");
            ArrayNode contentArray = userMsg.putArray("content");

            // Text part
            ObjectNode textPart = contentArray.addObject();
            textPart.put("text", userMessage);

            // Image part (base64)
            ObjectNode imagePart = contentArray.addObject();
            imagePart.put("image", "data:image/jpeg;base64," + Base64.getEncoder().encodeToString(imageData));

            // Parameters
            ObjectNode parameters = root.putObject("parameters");
            parameters.put("max_tokens", appConfig.getMaxOutputTokens());
            parameters.put("temperature", appConfig.getTemperature());

            return objectMapper.writeValueAsString(root);
        } catch (Exception e) {
            throw new RuntimeException("Failed to build multimodal request", e);
        }
    }

    /**
     * 调用通义千问 API (DashScope 原生格式)
     */
    private String callQwenApi(String requestBody) throws IOException {
        String url = appConfig.getQwenBaseUrl() + "/services/aigc/text-generation/generation";

        Request request = new Request.Builder()
                .url(url)
                .addHeader("Authorization", "Bearer " + appConfig.getQwenApiKey())
                .addHeader("Content-Type", "application/json")
                .post(RequestBody.create(requestBody, MediaType.parse("application/json")))
                .build();

        log.debug("Calling Qwen API: {}", url);

        try (Response response = httpClient.newCall(request).execute()) {
            String body = response.body() != null ? response.body().string() : "";

            if (!response.isSuccessful()) {
                log.error("Qwen API error: {} - {}", response.code(), body);
                throw new IOException("Qwen API returned " + response.code() + ": " + body);
            }

            return extractResponseText(body);
        }
    }

    /**
     * 调用通义千问 VL API (图像分析)
     */
    private String callQwenVLApi(String requestBody) throws IOException {
        String url = appConfig.getQwenBaseUrl() + "/services/aigc/multimodal-generation/generation";

        Request request = new Request.Builder()
                .url(url)
                .addHeader("Authorization", "Bearer " + appConfig.getQwenApiKey())
                .addHeader("Content-Type", "application/json")
                .post(RequestBody.create(requestBody, MediaType.parse("application/json")))
                .build();

        log.debug("Calling Qwen VL API: {}", url);

        try (Response response = httpClient.newCall(request).execute()) {
            String body = response.body() != null ? response.body().string() : "";

            if (!response.isSuccessful()) {
                log.error("Qwen VL API error: {} - {}", response.code(), body);
                throw new IOException("Qwen VL API returned " + response.code() + ": " + body);
            }

            return extractResponseText(body);
        }
    }

    /**
     * 从 DashScope 原生响应中提取文本
     * 支持两种格式:
     *   1. 纯文本生成: output.text
     *   2. 多模态生成:  output.choices[0].message.content[0].text
     */
    private String extractResponseText(String responseBody) throws IOException {
        JsonNode root = objectMapper.readTree(responseBody);

        JsonNode output = root.get("output");
        if (output != null) {
            // 格式 1: 纯文本生成 API — output.text
            JsonNode text = output.get("text");
            if (text != null) {
                return text.asText();
            }

            // 格式 2: 多模态生成 API — output.choices[0].message.content[0].text
            JsonNode choices = output.get("choices");
            if (choices != null && choices.isArray() && !choices.isEmpty()) {
                JsonNode firstChoice = choices.get(0);
                JsonNode message = firstChoice.get("message");
                if (message != null) {
                    // content 可能是字符串或数组
                    JsonNode content = message.get("content");
                    if (content != null) {
                        if (content.isTextual()) {
                            return content.asText();
                        }
                        if (content.isArray() && !content.isEmpty()) {
                            // 取第一个 text 元素
                            for (JsonNode part : content) {
                                JsonNode partText = part.get("text");
                                if (partText != null) {
                                    return partText.asText();
                                }
                            }
                        }
                    }
                }
            }
        }

        log.warn("Unexpected response structure: {}", responseBody);
        return "AI 未能生成有效回复，请重试。";
    }
}

package com.ai.conversation.model;

import java.util.ArrayList;
import java.util.List;

/**
 * 对话会话模型 - 管理单个 WebSocket 连接的对话上下文
 */
public class ConversationSession {

    private final String sessionId;
    private final List<ChatMessage> history;
    private byte[] lastFrame;         // 最近一帧图像
    private long lastFrameTime;       // 最近一帧时间戳
    private boolean cameraActive;

    private static final int MAX_HISTORY = 20; // 最多保留 20 条消息

    public ConversationSession(String sessionId) {
        this.sessionId = sessionId;
        this.history = new ArrayList<>();
        this.lastFrameTime = 0;
        this.cameraActive = false;
    }

    /**
     * 添加消息到历史记录，超出限制时移除最早的
     */
    public void addMessage(ChatMessage message) {
        history.add(message);
        // 保留最近的 MAX_HISTORY 条消息
        while (history.size() > MAX_HISTORY) {
            history.remove(0);
        }
    }

    /**
     * 更新视频帧 - 成本控制：记录时间戳用于自适应帧率
     */
    public void updateFrame(byte[] frame) {
        this.lastFrame = frame;
        this.lastFrameTime = System.currentTimeMillis();
    }

    /**
     * 判断是否应该处理新帧 (自适应帧率控制)
     * @param minIntervalMs 最小间隔毫秒数
     */
    public boolean shouldProcessFrame(long minIntervalMs) {
        return System.currentTimeMillis() - lastFrameTime >= minIntervalMs;
    }

    /**
     * 获取对话历史中的用户消息 (用于构建 Gemini API 请求)
     */
    public List<ChatMessage> getRecentHistory(int maxRounds) {
        int start = Math.max(0, history.size() - maxRounds * 2);
        return new ArrayList<>(history.subList(start, history.size()));
    }

    public void clearHistory() {
        history.clear();
        lastFrame = null;
    }

    // Getters
    public String getSessionId() { return sessionId; }
    public List<ChatMessage> getHistory() { return history; }
    public byte[] getLastFrame() { return lastFrame; }
    public boolean isCameraActive() { return cameraActive; }
    public void setCameraActive(boolean cameraActive) { this.cameraActive = cameraActive; }
}

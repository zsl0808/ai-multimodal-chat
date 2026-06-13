package com.ai.conversation.model;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * 聊天消息模型
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public class ChatMessage {

    public enum Type {
        TEXT,       // 文字消息
        IMAGE,      // 图像帧 (二进制，此模型仅用于内部处理)
        AUDIO,      // 音频数据
        CONTROL,    // 控制指令
        STATUS,     // 状态通知
        ERROR       // 错误消息
    }

    public enum Role {
        USER, ASSISTANT, SYSTEM
    }

    private Type type;
    private Role role;
    private String content;
    private String action;  // 用于 CONTROL 类型: start_camera, stop_camera, clear_history
    private String message; // 用于 STATUS/ERROR 类型
    private Long timestamp;

    public ChatMessage() {
        this.timestamp = System.currentTimeMillis();
    }

    public ChatMessage(Type type, Role role, String content) {
        this.type = type;
        this.role = role;
        this.content = content;
        this.timestamp = System.currentTimeMillis();
    }

    // Factory methods
    public static ChatMessage userText(String content) {
        return new ChatMessage(Type.TEXT, Role.USER, content);
    }

    public static ChatMessage assistantText(String content) {
        return new ChatMessage(Type.TEXT, Role.ASSISTANT, content);
    }

    public static ChatMessage status(String message) {
        ChatMessage msg = new ChatMessage(Type.STATUS, null, null);
        msg.setMessage(message);
        return msg;
    }

    public static ChatMessage error(String message) {
        ChatMessage msg = new ChatMessage(Type.ERROR, null, null);
        msg.setMessage(message);
        return msg;
    }

    // Getters and Setters
    public Type getType() { return type; }
    public void setType(Type type) { this.type = type; }

    public Role getRole() { return role; }
    public void setRole(Role role) { this.role = role; }

    public String getContent() { return content; }
    public void setContent(String content) { this.content = content; }

    public String getAction() { return action; }
    public void setAction(String action) { this.action = action; }

    public String getMessage() { return message; }
    public void setMessage(String message) { this.message = message; }

    public Long getTimestamp() { return timestamp; }
    public void setTimestamp(Long timestamp) { this.timestamp = timestamp; }
}

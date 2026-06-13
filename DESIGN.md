# AI 多模态对话应用 — 设计文档

## 一、项目概述

本项目是一个基于 Java + HTML + CSS + JS 的实时 AI 多模态对话应用。用户可以通过摄像头与麦克风与 AI 进行自然对话，AI 能够"看到"摄像头画面、"听到"用户语音，并给予恰当的文字或语音回复。

### 技术架构

```
┌─────────────────────────────────────────────────────────┐
│                    浏览器 (前端)                          │
│                                                          │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ Camera   │  │ Web Speech   │  │ Speech Synthesis │   │
│  │ 摄像头    │  │ API 语音识别  │  │ API 语音合成     │   │
│  └────┬─────┘  └──────┬───────┘  └────────┬─────────┘   │
│       │ JPEG帧         │ 文字              │             │
│       ▼                ▼                  ▲             │
│  ┌────────────────────────────────────────────────┐     │
│  │              WebSocket Client                   │     │
│  └───────────────────────┬────────────────────────┘     │
└──────────────────────────┼──────────────────────────────┘
                           │ ws://localhost:8080/ws/chat
┌──────────────────────────┼──────────────────────────────┐
│  Spring Boot 3.2         │                              │
│                          ▼                              │
│  ┌──────────────────────────────────────────────┐       │
│  │       MultimodalWebSocketHandler              │       │
│  │  - 接收文字消息/图像帧                          │       │
│  │  - 管理对话会话                                │       │
│  └──────────────────────┬───────────────────────┘       │
│                         │                                │
│  ┌──────────────────────▼───────────────────────┐       │
│  │           GeminiAIService                     │       │
│  │  - 组装 multimodal 请求                       │       │
│  │  - 调用 Gemini REST API                       │       │
│  │  - 管理对话上下文                              │       │
│  └──────────────────────┬───────────────────────┘       │
└─────────────────────────┼───────────────────────────────┘
                          │ HTTPS
                          ▼
                ┌──────────────────┐
                │  Google Gemini   │
                │  2.0 Flash API   │
                └──────────────────┘
```

## 二、用户故事 (User Stories)

### 计划实现的用户故事

| ID | 用户故事 | 优先级 | 描述 |
|---|---|---|---|
| US1 | 作为用户，我想要开启摄像头，让 AI 能实时看到我的画面并描述内容 | P0 | 核心功能：摄像头采集 → 帧捕获 → 发送到 AI → 返回描述 |
| US2 | 作为用户，我想要通过语音与 AI 对话，AI 能听懂我说的话 | P0 | 核心功能：麦克风 → 语音识别 → 文字 → AI 回复 |
| US3 | 作为用户，我想要 AI 综合视频画面和语音内容给出连贯回复 | P0 | 多模态融合：当摄像头开启时，文字消息自动附带当前画面 |
| US4 | 作为用户，我想要在不方便说话时用文字输入与 AI 交流 | P1 | 文字输入框 + Enter 发送 |
| US5 | 作为用户，我想要看到完整的对话历史记录 | P1 | 聊天界面显示所有历史消息 |
| US6 | 作为用户，我想要控制是否开启/关闭摄像头和麦克风 | P1 | 独立的开关按钮 |
| US7 | 作为用户，我想要 AI 用语音播报回复内容 | P2 | 使用浏览器 SpeechSynthesis API |
| US8 | 作为用户，我想要在连接断开时自动重连 | P2 | WebSocket 自动重连机制 |

### 最终实现情况

| ID | 状态 | 说明 |
|---|---|---|
| US1 | ✅ 已实现 | 摄像头开启后可点击"分析画面"按钮，AI 返回画面描述 |
| US2 | ✅ 已实现 | 使用 Web Speech API，点击麦克风按钮开始语音识别 |
| US3 | ✅ 已实现 | 摄像头开启时，发送文字消息会自动附带最近一帧画面 |
| US4 | ✅ 已实现 | 底部输入框支持 Enter 发送，Shift+Enter 换行 |
| US5 | ✅ 已实现 | 聊天面板显示所有消息，支持清除历史 |
| US6 | ✅ 已实现 | 摄像头和麦克风独立控制，有明确的状态指示 |
| US7 | ⏳ 待实现 | SpeechSynthesis 已集成到代码中，但未在 UI 中启用自动播报 |
| US8 | ✅ 已实现 | WebSocket 断开后自动重连，最多 10 次 |

## 三、成本控制策略

### 设计阶段想到的策略

| 编号 | 策略 | 描述 | 预期效果 |
|---|---|---|---|
| S1 | **选用最便宜的模型** | 使用 Gemini 2.0 Flash 而非 Pro，输入仅 $0.10/1M tokens | 相比 Pro 节省 90%+ 成本 |
| S2 | **自适应帧率** | 检测画面变化，静止画面不发送帧 | 减少 60-80% 图像 API 调用 |
| S3 | **图像压缩** | JPEG 质量 0.6 + 最大宽度 640px | 图像大小减少约 70% |
| S4 | **Web Speech API** | 使用浏览器内置语音识别，不调用 Whisper | 语音识别成本 = $0 |
| S5 | **浏览器 TTS** | 使用浏览器内置语音合成 | 语音合成成本 = $0 |
| S6 | **响应长度限制** | 限制 AI 回复不超过 300 tokens | 减少输出 token 消耗 |
| S7 | **上下文窗口控制** | 只保留最近 10 轮对话 | 减少输入 token 消耗 |
| S8 | **用户主动触发** | 需要用户点击"分析画面"才发送帧 | 避免无意义的持续分析 |
| S9 | **System Prompt 精简** | 指令简洁，要求回复控制在 200 字以内 | 减少每次请求的固定 token |
| S10 | **错误重试限制** | 不自动重试失败的 API 调用 | 避免错误场景下的成本浪费 |

### 实际采用的策略

| 编号 | 是否采用 | 实现位置 | 说明 |
|---|---|---|---|
| S1 | ✅ 采用 | `application.yml` → `gemini.model: gemini-2.0-flash` | Gemini 2.0 Flash 是目前最便宜的多模态模型之一 |
| S2 | ✅ 采用 | `camera.js` → `detectMotion()` | 使用像素采样法检测画面变化，变化小于阈值时不发送 |
| S3 | ✅ 采用 | `camera.js` → `CONFIG.jpegQuality: 0.6, maxWidth: 640` | 640x480 JPEG q=0.6 约 20-40KB/帧 |
| S4 | ✅ 采用 | `speech.js` → Web Speech API | Chrome 内置，完全免费 |
| S5 | ✅ 采用 | `speech.js` → `SpeechSynthesisUtterance` | 浏览器内置 TTS，免费 |
| S6 | ✅ 采用 | `application.yml` → `max-output-tokens: 300` | Gemini API 参数限制 |
| S7 | ✅ 采用 | `ConversationSession.java` → `MAX_HISTORY = 20` | 超出自动移除最早的 |
| S8 | ✅ 采用 | `app.js` → `btnAnalyze` 点击事件 | 只在用户点击时发送帧 |
| S9 | ✅ 采用 | `GeminiAIService.java` → `SYSTEM_PROMPT` | 精简指令，明确字数限制 |
| S10 | ✅ 采用 | `GeminiAIService.java` → 不自动重试 | 错误直接返回给用户 |

### 成本估算

假设一个典型 10 分钟对话场景：

| 项目 | 数量 | 单价 | 成本 |
|---|---|---|---|
| 文字输入 token | ~2000 tokens | $0.10/1M | $0.0002 |
| 文字输出 token | ~3000 tokens | $0.40/1M | $0.0012 |
| 图像帧 (用户主动分析) | 5-10 帧 | ~$0.001/帧 | $0.005-0.01 |
| 语音识别 (Web Speech API) | 无限 | $0 | $0 |
| 语音合成 (浏览器 TTS) | 无限 | $0 | $0 |
| **总计** | | | **~$0.01-0.02** |

> 10 分钟对话成本约 1-2 美分，非常经济。

## 四、技术选型理由

### 后端: Spring Boot 3.2 + Java 17

- 成熟的 WebSocket 支持
- 丰富的生态系统
- 符合题目要求使用 Java

### AI API: Google Gemini 2.0 Flash

- **最便宜**: 输入 $0.10/1M tokens，输出 $0.40/1M tokens
- **免费额度**: Google AI Studio 提供免费使用额度
- **多模态原生支持**: 单个 API 调用同时处理图像和文本
- **低延迟**: Flash 模型优化了响应速度

### 语音: Web Speech API

- **零成本**: 浏览器内置，无需额外 API
- **低延迟**: 本地处理，实时显示识别结果
- **中文支持好**: Chrome 使用 Google 的语音引擎

### 实时通信: 原生 WebSocket

- 不使用 STOMP/SockJS，减少复杂度
- 支持二进制帧传输（图像数据）
- 前后端直接 JSON 通信，简单高效

## 五、文件结构

```
QINIUYUN4/
├── pom.xml                                    # Maven 配置
├── DESIGN.md                                  # 本设计文档
├── README.md                                  # 项目说明
├── .gitignore                                 # Git 忽略配置
└── src/
    └── main/
        ├── java/com/ai/conversation/
        │   ├── AiConversationApplication.java  # Spring Boot 启动类
        │   ├── config/
        │   │   ├── AppConfig.java              # 应用配置 (Gemini API 等)
        │   │   └── WebSocketConfig.java        # WebSocket 路由配置
        │   ├── controller/
        │   │   └── PageController.java         # 页面路由
        │   ├── handler/
        │   │   └── MultimodalWebSocketHandler.java  # WebSocket 处理器
        │   ├── model/
        │   │   ├── ChatMessage.java            # 消息模型
        │   │   └── ConversationSession.java    # 会话模型
        │   └── service/
        │       └── GeminiAIService.java        # Gemini API 调用服务
        └── resources/
            ├── application.yml                 # 应用配置文件
            └── static/
                ├── index.html                  # 主页面
                ├── css/
                │   └── style.css               # 样式
                └── js/
                    ├── app.js                  # 主逻辑
                    ├── camera.js               # 摄像头模块
                    ├── speech.js               # 语音模块
                    └── websocket.js            # WebSocket 模块
```

## 六、消息协议

### 客户端 → 服务端

```json
// 文字消息
{"type": "TEXT", "content": "你好"}

// 控制指令
{"type": "CONTROL", "action": "start_camera"}
{"type": "CONTROL", "action": "stop_camera"}
{"type": "CONTROL", "action": "clear_history"}

// 图像帧 (二进制 WebSocket 帧)
<JPEG binary data>
```

### 服务端 → 客户端

```json
// AI 文字回复
{"type": "TEXT", "role": "ASSISTANT", "content": "你好！我看到你...", "timestamp": 1234567890}

// 状态通知
{"type": "STATUS", "message": "正在分析画面..."}

// 错误消息
{"type": "ERROR", "message": "API 调用失败"}
```

## 七、运行指南

### 前置条件

1. Java 17+
2. Maven 3.6+
3. Chrome 浏览器 (语音识别需要)
4. Google Gemini API Key

### 配置 API Key

```bash
# 方式一: 环境变量
export GEMINI_API_KEY=your-api-key-here

# 方式二: 修改 application.yml
# gemini.api-key: your-api-key-here
```

### 运行

```bash
mvn spring-boot:run
```

打开浏览器访问 `http://localhost:8080`

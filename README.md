# 🤖 AI 多模态对话应用

一个基于 Java Spring Boot 的实时 AI 多模态对话应用。通过摄像头和麦克风，与 AI 进行自然的视觉+语音交互。

## ✨ 功能特性

- 📷 **摄像头画面理解** — AI 能实时"看到"你的摄像头画面并描述内容
- 🎤 **语音对话** — 使用浏览器内置语音识别，与 AI 自然对话
- ⌨️ **文字输入** — 支持传统的文字聊天方式
- 🔍 **多模态融合** — 摄像头开启时，AI 自动结合画面和文字进行回复
- 💰 **成本优化** — 多项成本控制策略，10 分钟对话仅需约 1-2 美分

## 🏗️ 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Java 17 + Spring Boot 3.2 |
| 实时通信 | WebSocket |
| AI API | Google Gemini 2.0 Flash |
| 语音识别 | Web Speech API (浏览器内置) |
| 语音合成 | SpeechSynthesis API (浏览器内置) |
| 前端 | 原生 HTML + CSS + JavaScript |

## 🚀 快速开始

### 1. 获取 Gemini API Key

访问 [Google AI Studio](https://aistudio.google.com/app/apikey) 免费获取 API Key。

### 2. 配置 API Key

```bash
# 方式一: 环境变量 (推荐)
export GEMINI_API_KEY=your-api-key-here

# 方式二: 直接修改 src/main/resources/application.yml
```

### 3. 运行应用

```bash
# 使用 Maven
mvn spring-boot:run

# 或者打包后运行
mvn clean package -DskipTests
java -jar target/conversation-1.0.0.jar
```

### 4. 打开浏览器

访问 **http://localhost:8080** (推荐使用 Chrome 浏览器)

## 📖 使用说明

1. **开启摄像头** — 点击"开启摄像头"按钮，AI 就能看到你的画面
2. **分析画面** — 点击"分析画面"按钮，AI 会描述当前看到的内容
3. **语音对话** — 点击"开启麦克风"按钮，直接说话与 AI 交流
4. **文字聊天** — 在底部输入框输入文字，按 Enter 发送
5. **多模态** — 摄像头开启时发文字消息，AI 会结合画面一起回复

## 💰 成本控制

本应用采用了多项成本优化策略：

- 使用最便宜的 Gemini 2.0 Flash 模型
- 自适应帧率：静止画面不重复发送
- JPEG 压缩：640px 宽度，质量 0.6
- 浏览器内置语音识别和合成（免费）
- 限制 AI 回复长度和上下文窗口

> 10 分钟对话成本约 **$0.01 - $0.02**

## 📁 项目结构

```
src/main/
├── java/com/ai/conversation/
│   ├── AiConversationApplication.java    # 启动类
│   ├── config/                           # 配置
│   ├── controller/                       # 页面路由
│   ├── handler/                          # WebSocket 处理器
│   ├── model/                            # 数据模型
│   └── service/                          # AI 服务
└── resources/
    ├── application.yml                   # 配置文件
    └── static/                           # 前端文件
        ├── index.html
        ├── css/style.css
        └── js/{app,camera,speech,websocket}.js
```

## 📄 设计文档

详细的用户故事、成本控制策略和架构设计请参阅 [DESIGN.md](./DESIGN.md)

## License

MIT

/**
 * 应用主逻辑模块
 * 协调 WebSocket、Camera、Speech 模块的工作
 */
document.addEventListener('DOMContentLoaded', () => {
    // ---- DOM Elements ----
    const localVideo = document.getElementById('localVideo');
    const captureCanvas = document.getElementById('captureCanvas');
    const videoOverlay = document.getElementById('videoOverlay');
    const videoStatus = document.getElementById('videoStatus');
    const btnToggleCamera = document.getElementById('btnToggleCamera');
    const btnToggleMic = document.getElementById('btnToggleMic');
    const btnAnalyze = document.getElementById('btnAnalyze');
    const btnClearChat = document.getElementById('btnClearChat');
    const chatMessages = document.getElementById('chatMessages');
    const messageInput = document.getElementById('messageInput');
    const btnSend = document.getElementById('btnSend');
    const connectionStatus = document.getElementById('connectionStatus');
    const connectionText = document.getElementById('connectionText');
    const voiceStatus = document.getElementById('voiceStatus');
    const voiceText = document.getElementById('voiceText');

    // ---- State ----
    let cameraActive = false;
    let micActive = false;
    let isProcessing = false;

    // ---- Initialize Modules ----
    Camera.init(localVideo, captureCanvas);

    const speechInitialized = Speech.init({
        onResult: (text) => {
            if (text.trim()) {
                sendMessage(text);
            }
            hideVoiceStatus();
        },
        onInterim: (text) => {
            showVoiceStatus('🎤 ' + text);
        },
        onStart: () => {
            showVoiceStatus('正在聆听...');
        },
        onEnd: () => {
            hideVoiceStatus();
        },
        onError: (error) => {
            hideVoiceStatus();
            if (error === 'not-allowed') {
                addSystemMessage('⚠️ 麦克风权限被拒绝，请在浏览器设置中允许麦克风访问。');
            }
        }
    });

    // ---- WebSocket Events ----
    WS.on('statusChange', (status) => {
        connectionStatus.className = 'status-dot ' + status;
        const texts = {
            online: '已连接',
            offline: '未连接',
            connecting: '连接中...',
            failed: '连接失败'
        };
        connectionText.textContent = texts[status] || status;
    });

    WS.on('message', (msg) => {
        switch (msg.type) {
            case 'TEXT':
                if (msg.role === 'ASSISTANT') {
                    addAssistantMessage(msg.content);
                }
                break;
            case 'STATUS':
                if (msg.message) {
                    addStatusMessage(msg.message);
                }
                break;
            case 'ERROR':
                addErrorMessage(msg.message || '未知错误');
                break;
        }
    });

    // ---- Camera Control ----
    btnToggleCamera.addEventListener('click', async () => {
        try {
            const active = await Camera.toggle();
            cameraActive = active;
            updateCameraUI();

            if (active) {
                WS.sendControl('start_camera');
            } else {
                WS.sendControl('stop_camera');
            }
        } catch (err) {
            if (err.name === 'NotAllowedError') {
                addSystemMessage('⚠️ 摄像头权限被拒绝，请在浏览器设置中允许摄像头访问。');
            } else {
                addSystemMessage('⚠️ 无法开启摄像头: ' + err.message);
            }
        }
    });

    function updateCameraUI() {
        if (cameraActive) {
            btnToggleCamera.classList.add('active');
            btnToggleCamera.querySelector('.btn-text').textContent = '关闭摄像头';
            videoOverlay.classList.add('hidden');
            videoStatus.classList.remove('hidden');
            btnAnalyze.disabled = false;
        } else {
            btnToggleCamera.classList.remove('active');
            btnToggleCamera.querySelector('.btn-text').textContent = '开启摄像头';
            videoOverlay.classList.remove('hidden');
            videoStatus.classList.add('hidden');
            btnAnalyze.disabled = true;
        }
    }

    // ---- Analyze Button ----
    btnAnalyze.addEventListener('click', async () => {
        if (!cameraActive || isProcessing) return;

        isProcessing = true;
        btnAnalyze.disabled = true;
        addStatusMessage('📸 正在捕获画面...');

        try {
            const blob = await Camera.captureFrame();
            if (blob) {
                const buffer = await Camera.blobToArrayBuffer(blob);
                WS.sendBinary(buffer);
                addStatusMessage('🔍 AI 正在分析画面...');
            }
        } catch (err) {
            addErrorMessage('画面捕获失败: ' + err.message);
        } finally {
            isProcessing = false;
            if (cameraActive) {
                btnAnalyze.disabled = false;
            }
        }
    });

    // ---- Microphone Control ----
    btnToggleMic.addEventListener('click', () => {
        if (!speechInitialized) {
            addSystemMessage('⚠️ 您的浏览器不支持语音识别功能，请使用 Chrome 浏览器。');
            return;
        }

        micActive = Speech.toggleListening();
        updateMicUI();
    });

    function updateMicUI() {
        if (micActive) {
            btnToggleMic.classList.add('active');
            btnToggleMic.querySelector('.btn-text').textContent = '关闭麦克风';
        } else {
            btnToggleMic.classList.remove('active');
            btnToggleMic.querySelector('.btn-text').textContent = '开启麦克风';
        }
    }

    // ---- Voice Status ----
    function showVoiceStatus(text) {
        voiceStatus.classList.remove('hidden');
        voiceText.textContent = text;
    }

    function hideVoiceStatus() {
        voiceStatus.classList.add('hidden');
    }

    // ---- Chat Messages ----
    function addMessage(content, className) {
        const div = document.createElement('div');
        div.className = `message ${className}`;
        div.innerHTML = `
            <div class="message-content">${escapeHtml(content)}</div>
            <div class="message-meta">${formatTime(new Date())}</div>
        `;
        chatMessages.appendChild(div);
        scrollToBottom();
    }

    function addUserMessage(content) {
        addMessage(content, 'user-message');
    }

    function addAssistantMessage(content) {
        addMessage(content, 'assistant-message');
    }

    function addStatusMessage(text) {
        const div = document.createElement('div');
        div.className = 'message status-message';
        div.textContent = text;
        chatMessages.appendChild(div);
        scrollToBottom();

        // 自动移除状态消息
        setTimeout(() => {
            if (div.parentNode) {
                div.remove();
            }
        }, 5000);
    }

    function addErrorMessage(text) {
        const div = document.createElement('div');
        div.className = 'message error-message';
        div.textContent = '❌ ' + text;
        chatMessages.appendChild(div);
        scrollToBottom();
    }

    function addSystemMessage(text) {
        const div = document.createElement('div');
        div.className = 'message system-message';
        div.innerHTML = `<div class="message-content">${text}</div>`;
        chatMessages.appendChild(div);
        scrollToBottom();
    }

    function clearChat() {
        // Keep the welcome message
        chatMessages.innerHTML = `
            <div class="message system-message">
                <div class="message-content">
                    <p>👋 你好！我是你的 AI 助手。</p>
                    <p>你可以：</p>
                    <ul>
                        <li>📷 开启摄像头，让我看到你的画面</li>
                        <li>🎤 开启麦克风，用语音和我对话</li>
                        <li>⌨️ 在下方输入文字与我交流</li>
                    </ul>
                </div>
            </div>
        `;
        WS.sendControl('clear_history');
    }

    function scrollToBottom() {
        requestAnimationFrame(() => {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        });
    }

    // ---- Send Message ----
    function sendMessage(text) {
        if (!text.trim()) return;

        addUserMessage(text);
        WS.sendText(text);
        messageInput.value = '';
        autoResizeInput();
    }

    // ---- Input Handling ----
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage(messageInput.value);
        }
    });

    messageInput.addEventListener('input', autoResizeInput);

    btnSend.addEventListener('click', () => {
        sendMessage(messageInput.value);
    });

    btnClearChat.addEventListener('click', clearChat);

    function autoResizeInput() {
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
    }

    // ---- Utilities ----
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML.replace(/\n/g, '<br>');
    }

    function formatTime(date) {
        return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    }

    // ---- Auto Connect ----
    WS.connect();

    // ---- Load voices for TTS ----
    if (window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = () => {
            window.speechSynthesis.getVoices();
        };
    }

    console.log('[App] AI Multimodal Conversation initialized');
});

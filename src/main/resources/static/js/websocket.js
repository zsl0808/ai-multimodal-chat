/**
 * WebSocket 通信模块
 * 负责与 Spring Boot 后端的 WebSocket 连接管理
 */
const WS = (() => {
    let ws = null;
    let reconnectTimer = null;
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 10;
    const RECONNECT_DELAY = 2000;

    const listeners = {
        message: [],
        open: [],
        close: [],
        error: [],
        statusChange: []
    };

    /**
     * 获取 WebSocket URL
     */
    function getWsUrl() {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${protocol}//${location.host}/ws/chat`;
    }

    /**
     * 连接 WebSocket
     */
    function connect() {
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
            return;
        }

        const url = getWsUrl();
        console.log('[WS] Connecting to:', url);

        try {
            ws = new WebSocket(url);
            ws.binaryType = 'arraybuffer';

            ws.onopen = () => {
                console.log('[WS] Connected');
                reconnectAttempts = 0;
                emit('open');
                emit('statusChange', 'online');
            };

            ws.onmessage = (event) => {
                if (typeof event.data === 'string') {
                    try {
                        const msg = JSON.parse(event.data);
                        emit('message', msg);
                    } catch (e) {
                        console.warn('[WS] Non-JSON text message:', event.data);
                    }
                }
            };

            ws.onerror = (error) => {
                console.error('[WS] Error:', error);
                emit('error', error);
            };

            ws.onclose = (event) => {
                console.log('[WS] Disconnected, code:', event.code);
                emit('close', event);
                emit('statusChange', 'offline');
                scheduleReconnect();
            };

            emit('statusChange', 'connecting');
        } catch (e) {
            console.error('[WS] Connection failed:', e);
            scheduleReconnect();
        }
    }

    /**
     * 断开连接
     */
    function disconnect() {
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        if (ws) {
            ws.close();
            ws = null;
        }
    }

    /**
     * 自动重连
     */
    function scheduleReconnect() {
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            console.error('[WS] Max reconnect attempts reached');
            emit('statusChange', 'failed');
            return;
        }

        reconnectAttempts++;
        const delay = RECONNECT_DELAY * Math.min(reconnectAttempts, 5);
        console.log(`[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);

        reconnectTimer = setTimeout(() => {
            connect();
        }, delay);
    }

    /**
     * 发送 JSON 消息
     */
    function sendJson(obj) {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            console.error('[WS] Not connected');
            return false;
        }
        ws.send(JSON.stringify(obj));
        return true;
    }

    /**
     * 发送二进制数据 (图像帧)
     */
    function sendBinary(data) {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            console.error('[WS] Not connected');
            return false;
        }
        ws.send(data);
        return true;
    }

    /**
     * 发送文字消息
     */
    function sendText(text) {
        return sendJson({
            type: 'TEXT',
            content: text
        });
    }

    /**
     * 发送控制指令
     */
    function sendControl(action) {
        return sendJson({
            type: 'CONTROL',
            action: action
        });
    }

    /**
     * 事件监听
     */
    function on(event, callback) {
        if (!listeners[event]) {
            listeners[event] = [];
        }
        listeners[event].push(callback);
    }

    function off(event, callback) {
        if (listeners[event]) {
            listeners[event] = listeners[event].filter(cb => cb !== callback);
        }
    }

    function emit(event, data) {
        if (listeners[event]) {
            listeners[event].forEach(cb => {
                try { cb(data); } catch (e) { console.error('[WS] Listener error:', e); }
            });
        }
    }

    /**
     * 获取连接状态
     */
    function getState() {
        return ws ? ws.readyState : WebSocket.CLOSED;
    }

    function isConnected() {
        return ws && ws.readyState === WebSocket.OPEN;
    }

    return {
        connect,
        disconnect,
        sendJson,
        sendBinary,
        sendText,
        sendControl,
        on,
        off,
        getState,
        isConnected
    };
})();

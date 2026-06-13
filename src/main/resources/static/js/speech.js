/**
 * 语音模块
 * 使用 Web Speech API 实现语音识别和语音合成
 *
 * 成本控制: Web Speech API 完全免费，由浏览器内置引擎提供
 */
const Speech = (() => {
    let recognition = null;
    let synthesis = window.speechSynthesis;
    let isListening = false;
    let isSpeaking = false;

    // 回调函数
    let onResult = null;
    let onInterim = null;
    let onStart = null;
    let onEnd = null;
    let onError = null;

    /**
     * 检查浏览器支持
     */
    function isSupported() {
        return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
    }

    /**
     * 初始化语音识别
     */
    function init(callbacks = {}) {
        if (!isSupported()) {
            console.warn('[Speech] Web Speech API not supported in this browser');
            return false;
        }

        onResult = callbacks.onResult || (() => {});
        onInterim = callbacks.onInterim || (() => {});
        onStart = callbacks.onStart || (() => {});
        onEnd = callbacks.onEnd || (() => {});
        onError = callbacks.onError || (() => {});

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognition();

        // 配置
        recognition.lang = 'zh-CN';         // 中文
        recognition.continuous = true;       // 持续识别
        recognition.interimResults = true;   // 显示中间结果
        recognition.maxAlternatives = 1;

        // 事件处理
        recognition.onstart = () => {
            isListening = true;
            console.log('[Speech] Recognition started');
            onStart();
        };

        recognition.onresult = (event) => {
            let interimTranscript = '';
            let finalTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcript;
                } else {
                    interimTranscript += transcript;
                }
            }

            if (interimTranscript) {
                onInterim(interimTranscript);
            }

            if (finalTranscript) {
                console.log('[Speech] Final result:', finalTranscript);
                onResult(finalTranscript.trim());
            }
        };

        recognition.onerror = (event) => {
            console.error('[Speech] Error:', event.error);
            isListening = false;

            // 不中断: 'no-speech' 和 'aborted' 是正常情况
            if (event.error !== 'no-speech' && event.error !== 'aborted') {
                onError(event.error);
            }
        };

        recognition.onend = () => {
            isListening = false;
            console.log('[Speech] Recognition ended');
            onEnd();
        };

        return true;
    }

    /**
     * 开始语音识别
     */
    function startListening() {
        if (!recognition) {
            console.error('[Speech] Not initialized');
            return false;
        }

        if (isListening) {
            console.warn('[Speech] Already listening');
            return true;
        }

        try {
            recognition.start();
            return true;
        } catch (e) {
            console.error('[Speech] Failed to start:', e);
            return false;
        }
    }

    /**
     * 停止语音识别
     */
    function stopListening() {
        if (recognition && isListening) {
            recognition.stop();
        }
    }

    /**
     * 切换语音识别状态
     */
    function toggleListening() {
        if (isListening) {
            stopListening();
            return false;
        } else {
            startListening();
            return true;
        }
    }

    /**
     * 语音合成 (TTS) - 让 AI 说话
     * 成本控制: 浏览器内置 TTS，完全免费
     */
    function speak(text) {
        if (!synthesis) {
            console.warn('[Speech] Speech synthesis not supported');
            return;
        }

        // 取消当前正在播放的语音
        synthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'zh-CN';
        utterance.rate = 1.0;   // 语速
        utterance.pitch = 1.0;  // 音调
        utterance.volume = 1.0; // 音量

        // 尝试选择中文语音
        const voices = synthesis.getVoices();
        const zhVoice = voices.find(v => v.lang.startsWith('zh'));
        if (zhVoice) {
            utterance.voice = zhVoice;
        }

        utterance.onstart = () => {
            isSpeaking = true;
        };

        utterance.onend = () => {
            isSpeaking = false;
        };

        utterance.onerror = (e) => {
            isSpeaking = false;
            console.error('[Speech] TTS error:', e);
        };

        synthesis.speak(utterance);
    }

    /**
     * 停止语音播放
     */
    function stopSpeaking() {
        if (synthesis) {
            synthesis.cancel();
            isSpeaking = false;
        }
    }

    /**
     * 获取状态
     */
    function getIsListening() { return isListening; }
    function getIsSpeaking() { return isSpeaking; }

    return {
        isSupported,
        init,
        startListening,
        stopListening,
        toggleListening,
        speak,
        stopSpeaking,
        isListening: getIsListening,
        isSpeaking: getIsSpeaking
    };
})();

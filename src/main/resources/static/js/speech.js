/**
 * 语音模块
 * 使用浏览器 MediaRecorder 录制 + 后端语音识别
 *
 * 优势: 在任何网络环境下都能工作，不依赖 Google 服务
 */
const Speech = (() => {
    let mediaRecorder = null;
    let audioChunks = [];
    let synthesis = window.speechSynthesis;
    let isListening = false;
    let isSpeaking = false;
    let shouldContinueListening = false;  // 持续监听意图标记
    let recordingTimer = null;

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
        return navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
    }

    /**
     * 初始化语音识别
     */
    function init(callbacks = {}) {
        if (!isSupported()) {
            console.warn('[Speech] MediaRecorder not supported in this browser');
            return false;
        }

        onResult = callbacks.onResult || (() => {});
        onInterim = callbacks.onInterim || (() => {});
        onStart = callbacks.onStart || (() => {});
        onEnd = callbacks.onEnd || (() => {});
        onError = callbacks.onError || (() => {});

        return true;
    }

    /**
     * 开始语音识别
     */
    async function startListening() {
        if (isListening) {
            console.warn('[Speech] Already listening');
            return true;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'audio/webm;codecs=opus'
            });

            audioChunks = [];
            shouldContinueListening = true;

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunks.push(event.data);
                }
            };

            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                stream.getTracks().forEach(track => track.stop());

                if (audioBlob.size > 100) {
                    await sendAudioForRecognition(audioBlob);
                }

                isListening = false;
                onEnd();

                // 如果用户没有主动停止，自动重启录音（实现持续识别）
                if (shouldContinueListening) {
                    setTimeout(() => {
                        if (shouldContinueListening) {
                            startListening();
                        }
                    }, 100);
                }
            };

            mediaRecorder.onerror = (event) => {
                console.error('[Speech] MediaRecorder error:', event.error);
                isListening = false;
                shouldContinueListening = false;
                onError(event.error);
            };

            mediaRecorder.start(1000);
            isListening = true;
            onStart();
            showInterimStatus();

            // 3秒后自动停止当前录音段，触发 onstop 后会自动重启
            recordingTimer = setTimeout(() => {
                if (mediaRecorder && mediaRecorder.state === 'recording') {
                    mediaRecorder.stop();
                }
            }, 3000);

            return true;
        } catch (e) {
            console.error('[Speech] Failed to start:', e);
            shouldContinueListening = false;
            onError(e.message);
            return false;
        }
    }

    /**
     * 显示录音中间状态
     */
    function showInterimStatus() {
        if (isListening) {
            onInterim('🎤 正在录音...');
            setTimeout(() => {
                if (isListening) {
                    showInterimStatus();
                }
            }, 1000);
        }
    }

    /**
     * 发送音频到后端进行识别
     */
    async function sendAudioForRecognition(audioBlob) {
        try {
            const formData = new FormData();
            formData.append('audio', audioBlob, 'recording.webm');

            const response = await fetch('/api/speech/recognize', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error('Recognition request failed: ' + response.status);
            }

            const result = await response.json();

            if (result.text && result.text.trim()) {
                onResult(result.text.trim());
            }
        } catch (e) {
            console.error('[Speech] Recognition error:', e);
            // 不中断，继续录音
        }
    }

    /**
     * 停止语音识别
     */
    function stopListening() {
        shouldContinueListening = false;  // 标记为主动停止，onstop 中不再重启

        if (recordingTimer) {
            clearTimeout(recordingTimer);
            recordingTimer = null;
        }

        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
        }

        isListening = false;
    }

    /**
     * 切换语音识别状态
     */
    async function toggleListening() {
        if (isListening) {
            stopListening();
            return false;
        } else {
            const success = await startListening();
            return success;
        }
    }

    /**
     * 语音合成 (TTS) - 让 AI 说话
     */
    function speak(text) {
        if (!synthesis) {
            console.warn('[Speech] Speech synthesis not supported');
            return;
        }

        synthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'zh-CN';
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;

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

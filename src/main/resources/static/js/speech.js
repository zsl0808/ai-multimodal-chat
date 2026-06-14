/**
 * 语音模块
 * 优先使用浏览器 SpeechRecognition API (Web Speech API)
 * 降级使用 MediaRecorder 录制 + 后端语音识别
 */
const Speech = (() => {
    let recognition = null;       // Web Speech API
    let mediaRecorder = null;     // 降级方案: MediaRecorder
    let audioChunks = [];
    let synthesis = window.speechSynthesis;
    let isListening = false;
    let isSpeaking = false;
    let shouldContinueListening = false;
    let recordingTimer = null;
    let useBrowserAPI = false;    // 是否使用浏览器内置 API
    let browserAPIFailed = false; // 浏览器 API 是否已失败（用于降级）

    // 回调函数
    let onResult = null;
    let onInterim = null;
    let onStart = null;
    let onEnd = null;
    let onError = null;
    let onStateChange = null;

    /**
     * 检查浏览器支持
     */
    function isSupported() {
        // 优先检查 Web Speech API
        const hasSpeechRecognition = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
        const hasMediaRecorder = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
        return hasSpeechRecognition || hasMediaRecorder;
    }

    /**
     * 初始化语音识别
     */
    function init(callbacks = {}) {
        onResult = callbacks.onResult || (() => {});
        onInterim = callbacks.onInterim || (() => {});
        onStart = callbacks.onStart || (() => {});
        onEnd = callbacks.onEnd || (() => {});
        onError = callbacks.onError || (() => {});
        onStateChange = callbacks.onStateChange || (() => {});

        // 优先使用浏览器内置 SpeechRecognition
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            recognition = new SpeechRecognition();
            recognition.lang = 'zh-CN';
            recognition.interimResults = true;
            recognition.continuous = true;
            recognition.maxAlternatives = 1;

            recognition.onresult = (event) => {
                let interim = '';
                let final = '';
                for (let i = event.resultIndex; i < event.results.length; i++) {
                    const result = event.results[i];
                    if (result.isFinal) {
                        final += result[0].transcript;
                    } else {
                        interim += result[0].transcript;
                    }
                }
                if (final) {
                    console.log('[Speech] Final:', final);
                    onResult(final);
                }
                if (interim) {
                    console.log('[Speech] Interim:', interim);
                    onInterim(interim);
                }
            };

            recognition.onstart = () => {
                console.log('[Speech] Browser recognition started');
                isListening = true;
                onStart();
                onStateChange(true);
            };

            recognition.onend = () => {
                console.log('[Speech] Browser recognition ended');
                isListening = false;

                // 自动重启（持续监听）- 不隐藏状态避免跳动
                if (shouldContinueListening) {
                    console.log('[Speech] Auto-restarting browser recognition...');
                    setTimeout(() => {
                        if (shouldContinueListening) {
                            try { recognition.start(); } catch (e) { /* ignore */ }
                        }
                    }, 150);
                } else {
                    // 用户主动停止才隐藏状态
                    onEnd();
                    onStateChange(false);
                }
            };

            recognition.onerror = (event) => {
                console.error('[Speech] Browser recognition error:', event.error, event.message);
                if (event.error === 'not-allowed') {
                    isListening = false;
                    shouldContinueListening = false;
                    onStateChange(false);
                    onError('not-allowed');
                } else if (event.error === 'network' || event.error === 'service-not-allowed') {
                    // Google 语音服务不可用（国内被墙），降级到 MediaRecorder
                    console.warn('[Speech] Browser API unavailable, falling back to MediaRecorder');
                    isListening = false;
                    shouldContinueListening = false;
                    browserAPIFailed = true;
                    useBrowserAPI = false;
                    onStateChange(false);
                    // 自动用 MediaRecorder 重试
                    setTimeout(() => startMediaRecorder(), 300);
                }
                // 其他错误（no-speech, aborted 等）自动在 onend 中处理
            };

            useBrowserAPI = true;
            console.log('[Speech] Using browser SpeechRecognition API');
            return true;
        }

        // 降级: 检查 MediaRecorder 支持
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            useBrowserAPI = false;
            console.log('[Speech] Browser SpeechRecognition not available, using MediaRecorder fallback');
            return true;
        }

        console.warn('[Speech] Neither SpeechRecognition nor MediaRecorder supported');
        return false;
    }

    /**
     * 开始语音识别
     */
    async function startListening() {
        if (isListening) {
            console.warn('[Speech] Already listening');
            return true;
        }

        if (useBrowserAPI && recognition && !browserAPIFailed) {
            return startBrowserRecognition();
        } else {
            return startMediaRecorder();
        }
    }

    /**
     * 浏览器内置 SpeechRecognition
     */
    function startBrowserRecognition() {
        try {
            shouldContinueListening = true;
            recognition.start();
            return true;
        } catch (e) {
            console.error('[Speech] Failed to start browser recognition:', e);
            shouldContinueListening = false;
            onStateChange(false);
            onError(e.message);
            return false;
        }
    }

    /**
     * MediaRecorder 降级方案
     */
    async function startMediaRecorder() {
        try {
            console.log('[Speech] Requesting microphone permission...');
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            console.log('[Speech] Microphone granted');

            const audioTrack = stream.getAudioTracks()[0];
            if (audioTrack) {
                console.log('[Speech] Audio track:', audioTrack.label);
                audioTrack.onended = () => {
                    console.warn('[Speech] Audio track ended unexpectedly!');
                };
            }

            // 选择支持的 mime 类型
            let mimeType = '';
            const supportedTypes = [
                'audio/webm;codecs=opus',
                'audio/webm',
                'audio/ogg;codecs=opus',
                'audio/mp4'
            ];
            for (const type of supportedTypes) {
                if (MediaRecorder.isTypeSupported(type)) {
                    mimeType = type;
                    break;
                }
            }
            console.log('[Speech] Using mime type:', mimeType || 'browser default');

            const recorderOptions = mimeType ? { mimeType } : {};
            mediaRecorder = new MediaRecorder(stream, recorderOptions);
            audioChunks = [];
            shouldContinueListening = true;

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunks.push(event.data);
                }
            };

            mediaRecorder.onstop = async () => {
                console.log('[Speech] MediaRecorder stopped, chunks:', audioChunks.length);
                const audioBlob = new Blob(audioChunks, { type: mimeType || 'audio/webm' });
                stream.getTracks().forEach(track => track.stop());

                if (audioBlob.size > 100) {
                    console.log('[Speech] Sending audio for recognition, size:', audioBlob.size);
                    await sendAudioForRecognition(audioBlob);
                } else {
                    console.log('[Speech] Audio too small, skipping');
                }

                isListening = false;
                onEnd();

                if (shouldContinueListening) {
                    console.log('[Speech] Auto-restarting MediaRecorder...');
                    setTimeout(() => {
                        if (shouldContinueListening) {
                            startMediaRecorder();
                        }
                    }, 100);
                } else {
                    console.log('[Speech] User stopped, not restarting');
                    onStateChange(false);
                }
            };

            mediaRecorder.onerror = (event) => {
                console.error('[Speech] MediaRecorder error:', event.error);
                isListening = false;
                shouldContinueListening = false;
                onStateChange(false);
                onError(event.error);
            };

            mediaRecorder.start(1000);
            console.log('[Speech] MediaRecorder started, state:', mediaRecorder.state);

            isListening = true;
            onStart();
            onStateChange(true);
            showInterimStatus();

            // 3秒后自动停止当前录音段，触发 onstop 后会自动重启
            recordingTimer = setTimeout(() => {
                if (mediaRecorder && mediaRecorder.state === 'recording') {
                    console.log('[Speech] 3s cycle: stopping recorder');
                    mediaRecorder.stop();
                }
            }, 3000);

            return true;
        } catch (e) {
            console.error('[Speech] Failed to start MediaRecorder:', e.name, e.message);
            shouldContinueListening = false;
            onStateChange(false);
            onError(e.message);
            return false;
        }
    }

    /**
     * 显示录音中间状态
     */
    function showInterimStatus() {
        if (isListening) {
            onInterim('正在录音...');
            setTimeout(() => {
                if (isListening) {
                    showInterimStatus();
                }
            }, 1000);
        }
    }

    /**
     * 发送音频到后端进行识别（降级方案）
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
            if (result.error) {
                console.warn('[Speech] Backend recognition error:', result.error);
            }
        } catch (e) {
            console.error('[Speech] Recognition error:', e);
        }
    }

    /**
     * 停止语音识别
     */
    function stopListening() {
        shouldContinueListening = false;

        if (recordingTimer) {
            clearTimeout(recordingTimer);
            recordingTimer = null;
        }

        if (useBrowserAPI && recognition) {
            try {
                recognition.stop();
            } catch (e) {
                // recognition might already be stopped
            }
        }

        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
        }

        isListening = false;
        onStateChange(false);
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
     * 语音合成 (TTS)
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

        utterance.onstart = () => { isSpeaking = true; };
        utterance.onend = () => { isSpeaking = false; };
        utterance.onerror = (e) => {
            isSpeaking = false;
            console.error('[Speech] TTS error:', e);
        };

        synthesis.speak(utterance);
    }

    function stopSpeaking() {
        if (synthesis) {
            synthesis.cancel();
            isSpeaking = false;
        }
    }

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

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

        // 国内直接用 MediaRecorder + DashScope，跳过 Google SpeechRecognition
        // （Google 语音服务被墙，每次 network error 体验不好）
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            console.log('[Speech] Browser SpeechRecognition available but skipped (use MediaRecorder for reliability)');
        }

        // 使用 MediaRecorder 录制 + 后端 DashScope ASR
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
     * 将 WebM/Opus 音频 Blob 转换为 WAV 格式（16-bit, mono）
     * 不重采样，保留原始采样率；DashScope 会根据参数自动处理
     */
    async function convertToWav(webmBlob) {
        try {
            // 解码原始音频
            const audioContext = new AudioContext();
            const arrayBuffer = await webmBlob.arrayBuffer();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            const actualRate = audioBuffer.sampleRate;
            console.log('[Speech] Decoded audio:', actualRate + 'Hz',
                audioBuffer.numberOfChannels + 'ch', audioBuffer.duration.toFixed(1) + 's',
                'max:', Math.max(...audioBuffer.getChannelData(0)).toFixed(3));

            // 取第一声道，转 Int16
            const channelData = audioBuffer.getChannelData(0);
            const int16Data = new Int16Array(channelData.length);
            for (let i = 0; i < channelData.length; i++) {
                const s = Math.max(-1, Math.min(1, channelData[i]));
                int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }

            // 构建 WAV 文件
            const numChannels = 1;
            const bitsPerSample = 16;
            const byteRate = actualRate * numChannels * bitsPerSample / 8;
            const blockAlign = numChannels * bitsPerSample / 8;
            const dataSize = int16Data.length * 2;

            const buffer = new ArrayBuffer(44 + dataSize);
            const view = new DataView(buffer);

            function wstr(off, str) {
                for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
            }

            wstr(0, 'RIFF');
            view.setUint32(4, 36 + dataSize, true);
            wstr(8, 'WAVE');
            wstr(12, 'fmt ');
            view.setUint32(16, 16, true);
            view.setUint16(20, 1, true);        // PCM
            view.setUint16(22, numChannels, true);
            view.setUint32(24, actualRate, true);
            view.setUint32(28, byteRate, true);
            view.setUint16(32, blockAlign, true);
            view.setUint16(34, bitsPerSample, true);
            wstr(36, 'data');
            view.setUint32(40, dataSize, true);

            new Uint8Array(buffer, 44).set(new Uint8Array(int16Data.buffer));
            audioContext.close();

            console.log('[Speech] WAV created:', actualRate + 'Hz,', dataSize, 'bytes PCM');
            return new Blob([buffer], { type: 'audio/wav' });
        } catch (e) {
            console.error('[Speech] Failed to convert audio:', e);
            return null;
        }
    }

    /**
     * 发送音频到后端进行识别（降级方案）
     */
    async function sendAudioForRecognition(audioBlob) {
        try {
            // 将 WebM 转成 WAV（DashScope Paraformer 需要）
            console.log('[Speech] Converting WebM to WAV...');
            const wavBlob = await convertToWav(audioBlob);
            if (!wavBlob) {
                console.warn('[Speech] Audio conversion failed, skipping');
                return;
            }
            console.log('[Speech] WAV size:', wavBlob.size, 'bytes');

            const formData = new FormData();
            formData.append('audio', wavBlob, 'recording.wav');

            const response = await fetch('/api/speech/recognize', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error('Recognition request failed: ' + response.status);
            }

            const result = await response.json();
            console.log('[Speech] Backend response:', JSON.stringify(result));

            if (result.text && result.text.trim()) {
                console.log('[Speech] Recognized:', result.text);
                onResult(result.text.trim());
            } else if (result.error) {
                console.warn('[Speech] Backend recognition error:', result.error);
            } else {
                console.warn('[Speech] Backend returned empty text, no error');
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

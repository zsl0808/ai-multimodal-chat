/**
 * 摄像头模块
 * 负责摄像头的开启/关闭、视频帧捕获
 *
 * 成本控制策略:
 * 1. 自适应帧率 - 只在画面有变化时发送帧
 * 2. JPEG 压缩 - 降低图像质量减小体积
 * 3. 分辨率缩放 - 限制最大宽度为 640px
 * 4. 用户主动触发 - 需要用户点击"分析画面"才发送
 */
const Camera = (() => {
    let stream = null;
    let videoEl = null;
    let canvas = null;
    let ctx = null;
    let isActive = false;
    let captureTimer = null;

    // Cost control settings
    const CONFIG = {
        maxWidth: 640,          // 最大宽度 (像素)
        jpegQuality: 0.6,      // JPEG 压缩质量 (0-1)
        captureInterval: 5000,  // 自动捕获间隔 (ms)
        motionThreshold: 15,    // 画面变化阈值 (像素差异)
        motionPixelSample: 100  // 采样像素数量
    };

    // 上一帧的采样数据，用于变化检测
    let lastFrameSample = null;

    /**
     * 初始化摄像头模块
     */
    function init(videoElement, canvasElement) {
        videoEl = videoElement;
        canvas = canvasElement;
        ctx = canvas.getContext('2d', { willReadFrequently: true });
    }

    /**
     * 开启摄像头
     */
    async function start() {
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: CONFIG.maxWidth },
                    height: { ideal: 480 },
                    facingMode: 'user'
                },
                audio: false
            });

            videoEl.srcObject = stream;
            isActive = true;
            lastFrameSample = null;

            console.log('[Camera] Started');
            return true;
        } catch (err) {
            console.error('[Camera] Failed to start:', err);
            throw err;
        }
    }

    /**
     * 关闭摄像头
     */
    function stop() {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            stream = null;
        }
        videoEl.srcObject = null;
        isActive = false;
        lastFrameSample = null;

        if (captureTimer) {
            clearInterval(captureTimer);
            captureTimer = null;
        }

        console.log('[Camera] Stopped');
    }

    /**
     * 切换摄像头状态
     */
    async function toggle() {
        if (isActive) {
            stop();
            return false;
        } else {
            await start();
            return true;
        }
    }

    /**
     * 捕获当前帧为 JPEG Blob
     * @returns {Promise<Blob|null>}
     */
    function captureFrame() {
        if (!isActive || !videoEl.videoWidth) {
            return null;
        }

        // 计算缩放后的尺寸
        const width = Math.min(videoEl.videoWidth, CONFIG.maxWidth);
        const ratio = width / videoEl.videoWidth;
        const height = Math.floor(videoEl.videoHeight * ratio);

        // 设置 canvas 尺寸
        canvas.width = width;
        canvas.height = height;

        // 绘制视频帧到 canvas
        ctx.drawImage(videoEl, 0, 0, width, height);

        return new Promise((resolve) => {
            canvas.toBlob(
                (blob) => resolve(blob),
                'image/jpeg',
                CONFIG.jpegQuality
            );
        });
    }

    /**
     * 检测画面是否有明显变化 (简单像素采样法)
     * 成本控制: 避免在画面静止时发送重复帧
     * @returns {boolean}
     */
    function detectMotion() {
        if (!isActive || !videoEl.videoWidth) return false;

        const width = 160; // 低分辨率采样
        const ratio = width / videoEl.videoWidth;
        const height = Math.floor(videoEl.videoHeight * ratio);

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(videoEl, 0, 0, width, height);

        const imageData = ctx.getImageData(0, 0, width, height);
        const pixels = imageData.data;

        // 随机采样一些像素点
        const sampleCount = CONFIG.motionPixelSample;
        const currentSample = new Uint8Array(sampleCount * 3);

        for (let i = 0; i < sampleCount; i++) {
            const pixelIndex = Math.floor(Math.random() * (pixels.length / 4)) * 4;
            currentSample[i * 3] = pixels[pixelIndex];       // R
            currentSample[i * 3 + 1] = pixels[pixelIndex + 1]; // G
            currentSample[i * 3 + 2] = pixels[pixelIndex + 2]; // B
        }

        // 与上一帧比较
        if (lastFrameSample) {
            let totalDiff = 0;
            for (let i = 0; i < currentSample.length; i++) {
                totalDiff += Math.abs(currentSample[i] - lastFrameSample[i]);
            }
            const avgDiff = totalDiff / currentSample.length;

            lastFrameSample = currentSample;
            return avgDiff > CONFIG.motionThreshold;
        }

        lastFrameSample = currentSample;
        return true; // 第一帧默认有"变化"
    }

    /**
     * 将 Blob 转为 ArrayBuffer
     */
    function blobToArrayBuffer(blob) {
        return blob.arrayBuffer();
    }

    /**
     * 获取摄像头状态
     */
    function getIsActive() {
        return isActive;
    }

    return {
        init,
        start,
        stop,
        toggle,
        captureFrame,
        detectMotion,
        blobToArrayBuffer,
        isActive: getIsActive,
        CONFIG
    };
})();

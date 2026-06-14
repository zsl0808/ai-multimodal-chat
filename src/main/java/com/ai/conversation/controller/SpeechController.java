package com.ai.conversation.controller;

import com.ai.conversation.config.AppConfig;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import okhttp3.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

/**
 * 语音识别控制器
 * 使用 DashScope 语音识别 API (Paraformer)
 */
@RestController
@RequestMapping("/api/speech")
public class SpeechController {

    private static final Logger log = LoggerFactory.getLogger(SpeechController.class);
    private static final Path AUDIO_DIR = Paths.get(System.getProperty("java.io.tmpdir"), "qiniuyun4_audio");

    private final AppConfig appConfig;
    private final OkHttpClient httpClient;
    private final ObjectMapper objectMapper;

    public SpeechController(AppConfig appConfig) {
        this.appConfig = appConfig;
        this.objectMapper = new ObjectMapper();
        this.httpClient = new OkHttpClient.Builder()
                .connectTimeout(30, TimeUnit.SECONDS)
                .readTimeout(60, TimeUnit.SECONDS)
                .writeTimeout(30, TimeUnit.SECONDS)
                .build();
        // 确保临时目录存在
        try {
            Files.createDirectories(AUDIO_DIR);
        } catch (IOException e) {
            log.error("Failed to create audio temp directory", e);
        }
    }

    /**
     * 语音识别接口
     * 接收前端 MediaRecorder 录制的音频，转发给 DashScope ASR API
     */
    @PostMapping("/recognize")
    public ResponseEntity<Map<String, String>> recognize(
            @RequestParam("audio") MultipartFile audioFile,
            HttpServletRequest request) {
        try {
            log.info("Received audio file, size: {} bytes, contentType: {}",
                    audioFile.getSize(), audioFile.getContentType());

            // 1. 保存音频到临时目录
            String originalFilename = audioFile.getOriginalFilename();
            String extension = ".webm";
            if (originalFilename != null && originalFilename.contains(".")) {
                extension = originalFilename.substring(originalFilename.lastIndexOf('.'));
            }
            String filename = UUID.randomUUID() + extension;
            Path audioPath = AUDIO_DIR.resolve(filename);
            audioFile.transferTo(audioPath.toFile());
            log.info("Saved audio to: {}", audioPath.toAbsolutePath());

            // 2. 构建公网可访问的 URL
            String scheme = request.getHeader("X-Forwarded-Proto");
            if (scheme == null) scheme = request.getScheme();
            String host = request.getHeader("X-Forwarded-Host");
            if (host == null) host = request.getHeader("Host");
            if (host == null) host = "localhost:" + request.getServerPort();
            String audioUrl = scheme + "://" + host + "/api/speech/audio/" + filename;
            log.info("Audio public URL: {}", audioUrl);

            // 3. 调用 DashScope 语音识别 API
            String recognizedText = callSpeechRecognition(audioUrl);

            // 4. 清理临时文件
            try {
                Files.deleteIfExists(audioPath);
                log.info("Cleaned up temp audio file");
            } catch (IOException e) {
                log.warn("Failed to delete temp audio: {}", e.getMessage());
            }

            Map<String, String> response = new HashMap<>();
            response.put("text", recognizedText);
            return ResponseEntity.ok(response);

        } catch (Exception e) {
            log.error("Speech recognition failed", e);
            Map<String, String> response = new HashMap<>();
            response.put("text", "");
            response.put("error", e.getMessage());
            return ResponseEntity.ok(response);
        }
    }

    /**
     * 提供音频文件访问（供 DashScope API 下载）
     */
    @GetMapping("/audio/{filename}")
    public ResponseEntity<Resource> serveAudio(@PathVariable String filename) {
        Path audioPath = AUDIO_DIR.resolve(filename).normalize();
        if (!audioPath.startsWith(AUDIO_DIR)) {
            return ResponseEntity.notFound().build();
        }
        Resource resource = new FileSystemResource(audioPath);
        if (!resource.exists()) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType("audio/webm"))
                .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"" + filename + "\"")
                .body(resource);
    }

    /**
     * 调用 DashScope 语音识别 API (Paraformer) - 异步模式
     * 1. 提交任务获取 task_id
     * 2. 轮询等待结果
     */
    private String callSpeechRecognition(String audioUrl) throws IOException, InterruptedException {
        String apiUrl = "https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription";

        // 构建请求体
        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("model", "paraformer-v1");

        Map<String, Object> input = new HashMap<>();
        input.put("file_urls", new String[]{audioUrl});
        requestBody.put("input", input);

        Map<String, Object> parameters = new HashMap<>();
        parameters.put("language_hints", new String[]{"zh", "en"});
        requestBody.put("parameters", parameters);

        String jsonBody = objectMapper.writeValueAsString(requestBody);
        log.info("ASR request: {}", jsonBody);

        okhttp3.RequestBody requestBodyObj = okhttp3.RequestBody.create(
                jsonBody, okhttp3.MediaType.parse("application/json"));

        // 1. 提交异步任务
        Request submitRequest = new Request.Builder()
                .url(apiUrl)
                .addHeader("Authorization", "Bearer " + appConfig.getQwenApiKey())
                .addHeader("Content-Type", "application/json")
                .addHeader("X-DashScope-Async", "enable")
                .addHeader("X-DashScope-OSSResourceResolve", "enable")
                .post(requestBodyObj)
                .build();

        String taskId;
        try (Response response = httpClient.newCall(submitRequest).execute()) {
            String responseBody = response.body() != null ? response.body().string() : "";
            log.info("ASR submit response [{}]: {}", response.code(), responseBody);

            if (!response.isSuccessful()) {
                throw new IOException("Speech recognition submit failed: " + response.code() + " - " + responseBody);
            }

            JsonNode root = objectMapper.readTree(responseBody);
            JsonNode output = root.get("output");
            if (output == null || output.get("task_id") == null) {
                // 可能是同步调用直接返回结果
                return extractRecognizedText(responseBody);
            }
            taskId = output.get("task_id").asText();
            log.info("ASR task submitted: {}", taskId);
        }

        // 2. 轮询任务结果
        String taskUrl = "https://dashscope.aliyuncs.com/api/v1/tasks/" + taskId;
        for (int i = 0; i < 30; i++) {  // 最多等30秒
            Thread.sleep(1000);

            Request pollRequest = new Request.Builder()
                    .url(taskUrl)
                    .addHeader("Authorization", "Bearer " + appConfig.getQwenApiKey())
                    .get()
                    .build();

            try (Response response = httpClient.newCall(pollRequest).execute()) {
                String responseBody = response.body() != null ? response.body().string() : "";
                log.info("ASR poll [{}] [{}]: {}", i, response.code(),
                        responseBody.length() > 200 ? responseBody.substring(0, 200) + "..." : responseBody);

                if (!response.isSuccessful()) {
                    throw new IOException("Speech recognition poll failed: " + response.code());
                }

                JsonNode root = objectMapper.readTree(responseBody);
                JsonNode output = root.get("output");
                if (output != null) {
                    String status = output.has("task_status") ? output.get("task_status").asText() : "";
                    if ("SUCCEEDED".equals(status)) {
                        return extractRecognizedText(responseBody);
                    } else if ("FAILED".equals(status)) {
                        String msg = output.has("message") ? output.get("message").asText() : "unknown";
                        throw new IOException("ASR task failed: " + msg);
                    }
                    // PENDING 或 RUNNING，继续轮询
                }
            }
        }

        throw new IOException("ASR task timed out after 30s");
    }

    /**
     * 从 DashScope ASR 响应中提取识别的文本
     */
    private String extractRecognizedText(String responseBody) throws IOException {
        JsonNode root = objectMapper.readTree(responseBody);

        // DashScope 语音识别响应格式: output.results[0].transcript
        JsonNode output = root.get("output");
        if (output != null) {
            JsonNode results = output.get("results");
            if (results != null && results.isArray() && !results.isEmpty()) {
                JsonNode firstResult = results.get(0);
                JsonNode transcript = firstResult.get("transcript");
                if (transcript != null) {
                    return transcript.asText();
                }
            }
        }

        log.warn("Unexpected speech recognition response: {}", responseBody);
        return "";
    }
}

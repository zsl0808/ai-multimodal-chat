package com.ai.conversation.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;

@Configuration
public class AppConfig {

    @Value("${qwen.api-key}")
    private String qwenApiKey;

    @Value("${qwen.model}")
    private String qwenModel;

    @Value("${qwen.base-url}")
    private String qwenBaseUrl;

    @Value("${qwen.max-output-tokens}")
    private int maxOutputTokens;

    @Value("${qwen.temperature}")
    private double temperature;

    @Value("${cost-control.max-context-rounds}")
    private int maxContextRounds;

    @Value("${cost-control.frame-jpeg-quality}")
    private double frameJpegQuality;

    @Value("${cost-control.frame-max-width}")
    private int frameMaxWidth;

    // Getters
    public String getQwenApiKey() { return qwenApiKey; }
    public String getQwenModel() { return qwenModel; }
    public String getQwenBaseUrl() { return qwenBaseUrl; }
    public int getMaxOutputTokens() { return maxOutputTokens; }
    public double getTemperature() { return temperature; }
    public int getMaxContextRounds() { return maxContextRounds; }
    public double getFrameJpegQuality() { return frameJpegQuality; }
    public int getFrameMaxWidth() { return frameMaxWidth; }
}

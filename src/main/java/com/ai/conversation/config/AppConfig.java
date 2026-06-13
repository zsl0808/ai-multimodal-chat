package com.ai.conversation.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;

@Configuration
public class AppConfig {

    @Value("${gemini.api-key}")
    private String geminiApiKey;

    @Value("${gemini.model}")
    private String geminiModel;

    @Value("${gemini.base-url}")
    private String geminiBaseUrl;

    @Value("${gemini.max-output-tokens}")
    private int maxOutputTokens;

    @Value("${gemini.temperature}")
    private double temperature;

    @Value("${cost-control.max-context-rounds}")
    private int maxContextRounds;

    @Value("${cost-control.frame-jpeg-quality}")
    private double frameJpegQuality;

    @Value("${cost-control.frame-max-width}")
    private int frameMaxWidth;

    // Getters
    public String getGeminiApiKey() { return geminiApiKey; }
    public String getGeminiModel() { return geminiModel; }
    public String getGeminiBaseUrl() { return geminiBaseUrl; }
    public int getMaxOutputTokens() { return maxOutputTokens; }
    public double getTemperature() { return temperature; }
    public int getMaxContextRounds() { return maxContextRounds; }
    public double getFrameJpegQuality() { return frameJpegQuality; }
    public int getFrameMaxWidth() { return frameMaxWidth; }
}

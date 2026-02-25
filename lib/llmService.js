/**
 * LLM Service - OpenAI-compatible API client
 * Used for form field semantic recognition
 */

// Default settings
const DEFAULT_MODEL = 'gpt-3.5-turbo';
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const DEFAULT_MAX_TOKENS = 500;

/**
 * Call OpenAI-compatible API for chat completion
 */
export async function callChatCompletion(config, messages, options = {}) {
  const {
    endpoint = 'https://api.openai.com/v1/chat/completions',
    apiKey,
    model = DEFAULT_MODEL,
    timeout = DEFAULT_TIMEOUT,
    maxTokens = DEFAULT_MAX_TOKENS
  } = config;

  if (!apiKey) {
    throw new Error('API key is required');
  }

  // Build request body
  const requestBody = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature: 0.3, // Lower temperature for more deterministic results
    response_format: { type: 'json_object' } // Request JSON response
  };

  // Build fetch options
  const fetchOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody)
  };

  // Add timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  fetchOptions.signal = controller.signal;

  try {
    const response = await fetch(endpoint, fetchOptions);
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();

    // Extract content from response
    if (data.choices && data.choices.length > 0) {
      return {
        success: true,
        content: data.choices[0].message.content,
        usage: data.usage
      };
    }

    throw new Error('Invalid API response format');
  } catch (error) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeout}ms`);
    }

    throw error;
  }
}

/**
 * Recognize form fields using LLM
 * Returns field mappings based on semantic analysis
 */
export async function recognizeFormFields(formMetadata, config) {
  // Import here to avoid circular dependency
  const { buildLLMPrompt, parseLLMMapping } = await import('./formRecognizer.js');

  // Build prompt from form metadata
  const prompt = buildLLMPrompt(formMetadata);

  // Prepare messages
  const messages = [
    {
      role: 'system',
      content: 'You are a helpful assistant that analyzes web forms and maps form fields to standard field types. Always respond with valid JSON.'
    },
    {
      role: 'user',
      content: prompt
    }
  ];

  // Call API
  const result = await callChatCompletion(config, messages, {
    maxTokens: 1000,
    timeout: 30000
  });

  if (!result.success) {
    throw new Error('LLM API call failed');
  }

  // Parse response
  const mappings = parseLLMMapping(result.content, formMetadata);

  if (!mappings) {
    throw new Error('Failed to parse LLM response');
  }

  return {
    mappings,
    usage: result.usage
  };
}

/**
 * Generate website description using LLM (optional feature)
 * This is separate from form filling - user-triggered only
 */
export async function generateDescription(siteData, descriptionType = 'short', config) {
  const { siteName, siteUrl, existingDescription, category } = siteData;

  let prompt = '';
  let maxLength = 100;

  if (descriptionType === 'short') {
    maxLength = 150;
    prompt = `Generate a short, compelling description (under ${maxLength} characters) for a website.

Website: ${siteName}
URL: ${siteUrl}
Category: ${category || 'Not specified'}
${existingDescription ? `Existing description (for reference or improvement): ${existingDescription}` : ''}

Requirements:
- Write in a professional, engaging tone
- Highlight the main value proposition
- Include relevant keywords for SEO
- Keep it concise and impactful
- Return ONLY the description text, nothing else`;
  } else if (descriptionType === 'long') {
    maxLength = 500;
    prompt = `Generate a detailed description for a website.

Website: ${siteName}
URL: ${siteUrl}
Category: ${category || 'Not specified'}
${existingDescription ? `Existing description (to expand upon): ${existingDescription}` : ''}

Requirements:
- Write 2-3 paragraphs
- Describe key features and benefits
- Include relevant keywords
- Professional and engaging tone
- Return ONLY the description text, nothing else`;
  } else if (descriptionType === 'tagline') {
    maxLength = 50;
    prompt = `Generate a catchy tagline/slogan (under ${maxLength} characters) for a website.

Website: ${siteName}
URL: ${siteUrl}
Category: ${category || 'Not specified'}

Requirements:
- Short, memorable, and impactful
- Capture the essence of the website
- Return ONLY the tagline text, nothing else`;
  }

  const messages = [
    {
      role: 'system',
      content: 'You are a copywriting expert specializing in website descriptions and marketing copy.'
    },
    {
      role: 'user',
      content: prompt
    }
  ];

  const result = await callChatCompletion(config, messages, {
    maxTokens: 300,
    timeout: 20000
  });

  if (!result.success) {
    throw new Error('LLM API call failed');
  }

  return result.content.trim().replace(/^["']|["']$/g, '');
}

/**
 * Test API connection
 */
export async function testConnection(config) {
  try {
    const messages = [
      {
        role: 'user',
        content: 'Respond with this exact JSON: {"status": "ok"}'
      }
    ];

    const result = await callChatCompletion(config, messages, {
      maxTokens: 50,
      timeout: 10000
    });

    return result.success;
  } catch (error) {
    console.error('[LLM Service] Connection test failed:', error);
    return false;
  }
}

/**
 * Validate API config
 */
export function validateConfig(config) {
  if (!config || typeof config !== 'object') {
    return { valid: false, error: 'Config must be an object' };
  }

  if (!config.endpoint) {
    return { valid: false, error: 'API endpoint is required' };
  }

  if (!config.apiKey) {
    return { valid: false, error: 'API key is required' };
  }

  // Validate endpoint URL
  try {
    new URL(config.endpoint);
  } catch {
    return { valid: false, error: 'Invalid API endpoint URL' };
  }

  return { valid: true };
}

/**
 * Get default config for common providers
 */
export function getDefaultProviderConfig(provider) {
  const configs = {
    openai: {
      endpoint: 'https://api.openai.com/v1/chat/completions',
      model: 'gpt-3.5-turbo'
    },
    azure: {
      endpoint: 'https://YOUR_RESOURCE.openai.azure.com/openai/deployments/YOUR_DEPLOYMENT/chat/completions?api-version=2023-05-15',
      model: 'gpt-35-turbo'
    },
    glm: {
      endpoint: 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions',
      model: 'glm-4.7'  // GLM-4.7 模型
    },
    groq: {
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      model: 'llama3-8b-8192'
    },
    anthropic: {
      endpoint: 'https://api.anthropic.com/v1/messages',
      model: 'claude-3-haiku-20240307',
      // Note: Anthropic uses different format, needs special handling
      isAnthropic: true
    },
    custom: {
      endpoint: '',
      model: ''
    }
  };

  return configs[provider] || configs.custom;
}

/**
 * Handle Anthropic API (special format)
 */
async function callAnthropicAPI(config, messages, options = {}) {
  const { endpoint, apiKey, model = 'claude-3-haiku-20240307', timeout = 30000 } = config;

  // Anthropic uses different message format
  const systemMessage = messages.find(m => m.role === 'system');
  const userMessages = messages.filter(m => m.role !== 'system');

  const requestBody = {
    model,
    max_tokens: options.maxTokens || DEFAULT_MAX_TOKENS,
    system: systemMessage?.content || '',
    messages: userMessages
  };

  const fetchOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(requestBody)
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  fetchOptions.signal = controller.signal;

  try {
    const response = await fetch(endpoint, fetchOptions);
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();

    return {
      success: true,
      content: data.content[0]?.text || '',
      usage: data.usage
    };
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

// Export for testing
export default {
  callChatCompletion,
  recognizeFormFields,
  generateDescription,
  testConnection,
  validateConfig,
  getDefaultProviderConfig
};

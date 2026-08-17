import fs from 'fs';
let code = fs.readFileSync('src/lib/fallbackManager.ts', 'utf8');

const target = `      const streamContent = streamResult.content;

      // Verify response validity
      if (!streamContent || streamContent.trim().length === 0) {
        throw new Error('Invalid Response: Server returned empty output string.');
      }

      const actualExecutedModel = streamResult.actualModel || currentModel;

      // Successful completion!
      return {
        content: streamContent,
        finalModel: actualExecutedModel,
        fallbackOccurred: attempts > 1,
        usage: streamResult.usage,
        grounding: streamResult.grounding,
        finishReason: streamResult.finishReason,
      };`;

const replacement = `      let streamContent = streamResult.content;
      let finalFinishReason = streamResult.finishReason;
      let finalUsage = streamResult.usage;

      // Automatic token expansion on truncation detection
      if (finalFinishReason === 'length' || finalFinishReason === 'max_tokens') {
        let continuationCount = 0;
        const maxContinuations = 2; // Allow up to 2 auto-expansions
        let currentMessages = [...messages];
        let currentMaxTokens = maxTokens ? maxTokens * 1.5 : 4000;

        while ((finalFinishReason === 'length' || finalFinishReason === 'max_tokens') && continuationCount < maxContinuations) {
          continuationCount++;
          console.log(\`[Token Expansion] Truncation detected for \${currentModel}. Auto-expanding tokens (Attempt \${continuationCount})...\`);
          
          currentMessages = [
            ...currentMessages,
            { role: 'assistant', content: streamContent },
            { role: 'user', content: 'Continue exactly where you left off. Do not repeat anything from your previous response, just pick up from the exact last word.' }
          ];

          const contResult = await streamOpenRouterCompletion({
            apiKey,
            model: currentModel,
            messages: currentMessages,
            temperature,
            maxTokens: Math.floor(currentMaxTokens),
            budget,
            query,
            signal,
            disableFallback,
            onToken: (chunk) => {
              if (chunk) hasTokenStreamed = true;
              if (onToken) onToken(chunk);
            },
            onGrounding
          });

          streamContent += contResult.content;
          finalFinishReason = contResult.finishReason;
          if (contResult.usage && finalUsage) {
             finalUsage = {
                promptTokens: (finalUsage.promptTokens || 0) + (contResult.usage.promptTokens || 0),
                completionTokens: (finalUsage.completionTokens || 0) + (contResult.usage.completionTokens || 0),
                totalTokens: (finalUsage.totalTokens || 0) + (contResult.usage.totalTokens || 0)
             };
          } else {
             finalUsage = contResult.usage || finalUsage;
          }
          currentMaxTokens *= 1.5;
        }
      }

      // Verify response validity
      if (!streamContent || streamContent.trim().length === 0) {
        throw new Error('Invalid Response: Server returned empty output string.');
      }

      const actualExecutedModel = streamResult.actualModel || currentModel;

      // Successful completion!
      return {
        content: streamContent,
        finalModel: actualExecutedModel,
        fallbackOccurred: attempts > 1,
        usage: finalUsage,
        grounding: streamResult.grounding,
        finishReason: finalFinishReason,
      };`;

if (code.includes(target)) {
    code = code.replace(target, replacement);
    fs.writeFileSync('src/lib/fallbackManager.ts', code);
    console.log("fallbackManager.ts updated successfully.");
} else {
    console.log("Target not found in fallbackManager.ts.");
}

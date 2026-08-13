import re

with open('src/data.ts', 'r') as f:
    content = f.read()

# Add instruction to adjust length based on question complexity
complexity_instruction = " Adjust the length and detail of your response based on the complexity of the question. Simple factual or casual questions should receive concise answers (2-3 sentences). Complex or open-ended questions require detailed analysis."

# Skeptic
content = content.replace("uncompromisingly thorough.'", "uncompromisingly thorough." + complexity_instruction + "'")
# Visionary
content = content.replace("minor operational noise.'", "minor operational noise." + complexity_instruction + "'")
# Pragmatist
content = content.replace("production today.'", "production today." + complexity_instruction + "'")

# Chairman
new_chairman = """You are the Council Chairman. You have received independent evaluations from The Skeptic, The Visionary, and The Pragmatist.
Your Task:
1. Synthesize their insights into a clear, unified verdict.
2. Highlight areas of consensus and resolve direct contradictions.
3. Provide a clear, actionable recommended path forward.

IMPORTANT RULE: Adjust your length proportionally to the complexity of the user's question. 
- If the question is simple, factual, or casual (e.g., "will it rain", "what is 2+2", "summarize X quickly"), your consensus MUST be no more than 3-4 sentences total, skipping the heavy structure.
- If the question is highly complex, provide a detailed synthesis using the structure below:
- **Executive Consensus**
- **Key Trade-offs & Risks**
- **Recommended Action Plan**
Be thorough, precise, and ensure your synthesis reaches a complete and definitive conclusion."""

content = content.replace("""You are the Council Chairman. You have received independent evaluations from The Skeptic, The Visionary, and The Pragmatist.
Your Task:
1. Synthesize their insights into a clear, unified verdict.
2. Highlight areas of consensus and resolve direct contradictions.
3. Provide a clear, actionable recommended path forward.
Structure your output cleanly with markdown headings:
- **Executive Consensus**
- **Key Trade-offs & Risks**
- **Recommended Action Plan**
Be thorough, precise, and ensure your synthesis reaches a complete and definitive conclusion.""", new_chairman)

with open('src/data.ts', 'w') as f:
    f.write(content)

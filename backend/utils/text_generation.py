"""
LLM text generation helpers for summaries.
Supports OpenAI-compatible Chat Completions APIs, Azure OpenAI endpoints, and Anthropic Messages API.
"""
import requests

from config import settings

# User-facing message when the combined prompt exceeds the configured input limit
REQUEST_TOO_LARGE_MESSAGE = (
    "This request is too large: the retrieved context from your documents exceeds the limit. "
    "Try asking a more specific question, or select fewer documents in Context to narrow the scope."
)


class SummaryGenerationService:
    def __init__(self):
        self.enabled = settings.summary_llm_enabled
        self.provider = (settings.summary_llm_provider or "openai").strip().lower()
        self.api_url = (settings.summary_llm_api_url or "").strip()
        self.api_key = (settings.summary_llm_api_key or "").strip()
        self.model = (settings.summary_llm_model or "").strip()
        self.timeout_seconds = settings.summary_llm_timeout_seconds
        self.temperature = settings.summary_llm_temperature
        self.max_output_tokens = settings.summary_llm_max_output_tokens

    def is_available(self) -> bool:
        if not self.enabled:
            return False
        if not self.api_url or not self.api_key:
            return False
        # All providers except azure require an explicit model name
        if self.provider != "azure" and not self.model:
            return False
        return True

    def _headers(self) -> dict:
        if self.provider == "azure":
            return {
                "Content-Type": "application/json",
                "api-key": self.api_key,
            }
        if self.provider == "anthropic":
            return {
                "Content-Type": "application/json",
                "x-api-key": self.api_key,
                "anthropic-version": "2023-06-01",
            }
        # openai (default)
        return {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }

    def summarize(self, source_text: str, instructions: str | None = None) -> str:
        if not self.is_available():
            raise RuntimeError("Summary LLM service is not configured")

        system_prompt = (
            "You are a secure enterprise summarization assistant. "
            "Summarize only the provided document context. "
            "Synthesize across the full context rather than focusing only on the beginning. "
            "Capture the main purpose, major sections, key policies or responsibilities, important numbers or timelines, and any consequences or decision-relevant points when present. "
            "Do not invent facts. If context is partial, say so briefly without overemphasizing missing information. "
            "Default output should be an executive-style summary in one concise paragraph of 3 to 5 sentences, unless the user explicitly asks for a longer or more detailed summary."
        )

        user_prompt = (
            f"User instructions (optional): {instructions.strip() if instructions else 'None'}\n\n"
            "Create a clear, high-quality summary of the document context below. "
            "Focus on what matters most overall, not just isolated details.\n\n"
            f"Document context:\n{source_text}"
        )

        return self._generate_from_messages(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ]
        )

    def suggest_folder_name(self, document_excerpt: str) -> str:
        """Suggest a short folder name (2–4 words) from document content. Returns plain name, no prefix."""
        if not self.is_available():
            raise RuntimeError("LLM service is not configured")
        excerpt = (document_excerpt or "").strip()[:4000]
        if not excerpt:
            raise ValueError("No document excerpt provided")

        system_prompt = (
            "You suggest short folder names for organizing documents. "
            "Reply with only the folder name: 2 to 4 words, title case, no quotes or punctuation. "
            "Base the name on the document's topic or type (e.g. 'German Recipes', 'Q4 Reports')."
        )
        user_prompt = f"Suggest a folder name for this document:\n\n{excerpt}"

        out = self._generate_from_messages(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ]
        )
        name = (out or "").strip().strip('"\'.,;:')
        return name if name else "New folder"

    def generate_grounded_response(self, user_query: str, retrieved_context: str) -> str:
        if not self.is_available():
            raise RuntimeError("Summary LLM service is not configured")

        system_prompt = (
            "You are Ada, a helpful assistant for internal knowledge work. "
            "Answer the user's question based on the retrieved context below. "
            "Use the context when it is relevant; synthesize and explain clearly. "
            "Do not invent facts or cite information that is not in the context. "
            "For any numbers, ranges, dates, durations, percentages, or quantities, use the exact values from context and do not alter them. "
            "If an exact value is not present in context, say it is not specified instead of estimating. "
            "If the context genuinely does not contain information needed to answer, say so briefly and suggest rephrasing or checking other documents. "
            "Keep answers concise and non-repetitive: do not restate the question, avoid repeating the same fact in different wording, and avoid filler phrases like 'based on the context provided'. "
            "Prefer 2-4 sentences unless the user explicitly asks for detailed output. "
            "When a direct sentence in context answers the question, quote or closely paraphrase that sentence first, then add at most one short follow-up sentence. "
        )
        user_prompt = (
            f"User question: {user_query}\n\n"
            "Retrieved context from the user's documents:\n"
            f"{retrieved_context}\n\n"
            "Provide a clear, direct answer based on the context above. "
            "Return only the final answer text, with no meta commentary about your process."
        )

        max_chars = getattr(settings, "summary_llm_max_input_chars", 12000)
        if len(system_prompt) + len(user_prompt) > max_chars:
            return REQUEST_TOO_LARGE_MESSAGE

        return self._generate_from_messages(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ]
        )

    def _generate_from_messages(self, messages: list[dict]) -> str:
        if self.provider == "anthropic":
            return self._generate_anthropic(messages)
        return self._generate_openai_compat(messages)

    def _generate_openai_compat(self, messages: list[dict]) -> str:
        """OpenAI and Azure OpenAI chat completions format."""
        payload: dict = {
            "messages": messages,
            "temperature": self.temperature,
            "max_tokens": self.max_output_tokens,
        }
        if self.provider != "azure":
            payload["model"] = self.model

        response = requests.post(
            self.api_url,
            headers=self._headers(),
            json=payload,
            timeout=self.timeout_seconds,
        )
        if response.status_code != 200:
            raise RuntimeError(
                f"Summary generation provider error (HTTP {response.status_code}): "
                f"{response.text[:200]}"
            )
        data = response.json()
        content = (
            data.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        )
        if not content or not content.strip():
            raise RuntimeError("Summary generation provider returned empty content")
        return content.strip()

    def _generate_anthropic(self, messages: list[dict]) -> str:
        """Anthropic Messages API format.

        Anthropic requires the system prompt as a top-level field; user/assistant
        turns go in the 'messages' array without a 'system' role.
        """
        system_text = ""
        user_messages = []
        for msg in messages:
            if msg.get("role") == "system":
                system_text = msg.get("content", "")
            else:
                user_messages.append(msg)

        payload: dict = {
            "model": self.model,
            "max_tokens": self.max_output_tokens,
            "temperature": self.temperature,
            "messages": user_messages,
        }
        if system_text:
            payload["system"] = system_text

        response = requests.post(
            self.api_url,
            headers=self._headers(),
            json=payload,
            timeout=self.timeout_seconds,
        )
        if response.status_code != 200:
            raise RuntimeError(
                f"Anthropic API error (HTTP {response.status_code}): "
                f"{response.text[:200]}"
            )
        data = response.json()
        # Anthropic response: {"content": [{"type": "text", "text": "..."}], ...}
        content_blocks = data.get("content", [])
        text = " ".join(
            block.get("text", "") for block in content_blocks if block.get("type") == "text"
        ).strip()
        if not text:
            raise RuntimeError("Anthropic API returned empty content")
        return text


summary_generation_service = SummaryGenerationService()

import httpx
import asyncio
import logging
from typing import Dict, Any, Optional
from datetime import datetime, timedelta
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class ModelCache:
    """Thread-safe cache for OpenRouter model data."""
    data: Optional[Dict[str, Any]] = None
    expires: datetime = field(default_factory=lambda: datetime.min)
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    
    @property
    def lock(self) -> asyncio.Lock:
        return self._lock


# Global cache instance
_model_cache = ModelCache()


async def fetch_openrouter_models() -> Dict[str, Any]:
    """
    Fetch models from OpenRouter API.
    Returns a dictionary mapping model ID to model data (pricing, context_length).
    Thread-safe with asyncio.Lock to prevent race conditions.
    """
    async with _model_cache.lock:
        now = datetime.now()
        
        # Check if cache is still valid
        if _model_cache.data and _model_cache.expires > now:
            return _model_cache.data
        
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get("https://openrouter.ai/api/v1/models")
                
                if response.status_code != 200:
                    logger.error(f"Failed to fetch OpenRouter models: {response.status_code} {response.text}")
                    # Return expired cache if available
                    if _model_cache.data:
                        return _model_cache.data
                    return {}
                
                data = response.json()
                models_data = data.get("data", [])
                
                # Process and index by ID for easy lookup
                processed_models = {}
                for model in models_data:
                    model_id = model.get("id")
                    if model_id:
                        processed_models[model_id] = {
                            "id": model_id,
                            "name": model.get("name"),
                            "context_length": model.get("context_length"),
                            "pricing": model.get("pricing", {
                                "prompt": "0",
                                "completion": "0"
                            })
                        }
                
                # Update cache (expire in 1 hour)
                _model_cache.data = processed_models
                _model_cache.expires = now + timedelta(hours=1)
                
                return processed_models
                
        except Exception as e:
            logger.error(f"Error fetching OpenRouter models: {str(e)}")
            # Return expired cache if available on error
            if _model_cache.data:
                return _model_cache.data
            return {}

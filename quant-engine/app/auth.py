from __future__ import annotations

import json
import os
import time
import urllib.request
from typing import Any

import jwt
from fastapi import HTTPException

_JWKS_CACHE: dict[str, Any] = {"expires_at": 0.0, "keys": {}}

def _cognito_configured() -> bool:
    return bool(os.getenv("COGNITO_USER_POOL_ID") and os.getenv("COGNITO_APP_CLIENT_ID"))

def _issuer() -> str:
    return f"https://cognito-idp.{os.environ['COGNITO_REGION']}.amazonaws.com/{os.environ['COGNITO_USER_POOL_ID']}"

def _jwks() -> dict[str, Any]:
    now = time.time()
    if now < _JWKS_CACHE["expires_at"] and _JWKS_CACHE["keys"]:
        return _JWKS_CACHE["keys"]
    with urllib.request.urlopen(_issuer() + "/.well-known/jwks.json", timeout=5) as response:
        keys = json.load(response)
    _JWKS_CACHE["keys"] = keys
    _JWKS_CACHE["expires_at"] = now + 3600
    return keys

def _key_for(token: str):
    kid = jwt.get_unverified_header(token).get("kid")
    for key in _jwks()["keys"]:
        if key.get("kid") == kid:
            return jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(key))
    raise HTTPException(status_code=401, detail="Unknown Cognito signing key")

def verify_access_token(token: str) -> dict[str, Any]:
    try:
        claims = jwt.decode(
            token,
            _key_for(token),
            algorithms=["RS256"],
            issuer=_issuer(),
            options={"verify_aud": False},
        )
    except (jwt.PyJWTError, ValueError, KeyError, TimeoutError, OSError) as exc:
        raise HTTPException(status_code=401, detail="Invalid Cognito access token") from exc
    if claims.get("token_use") != "access":
        raise HTTPException(status_code=401, detail="Cognito access token required")
    if claims.get("client_id") != os.environ["COGNITO_APP_CLIENT_ID"]:
        raise HTTPException(status_code=401, detail="Token was issued to an unexpected client")
    return claims

def require_auth(authorization: str | None, api_key: str | None) -> dict[str, Any] | None:
    if _cognito_configured():
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Bearer access token required")
        return verify_access_token(authorization[7:].strip())
    expected = os.getenv("QUANT_ENGINE_API_KEY")
    if not expected:
        raise HTTPException(status_code=503, detail="Quant engine authentication is not configured")
    if api_key != expected:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return None

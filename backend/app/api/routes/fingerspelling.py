"""Fingerspelling pack routes (docs/CONTRACT.md, "Fingerspelling packs")."""

from fastapi import APIRouter, HTTPException

from app.schemas.fingerspelling import FingerspellingPack
from app.services.fingerspelling import PackCatalog

router = APIRouter(tags=["fingerspelling"])
_packs = PackCatalog()


@router.get("/fingerspelling/packs", response_model=list[FingerspellingPack])
async def list_packs() -> list[FingerspellingPack]:
    """Every fingerspelling pack with its letters, recorded or not recorded yet."""
    return _packs.list()


@router.get("/fingerspelling/packs/{pack_id}", response_model=FingerspellingPack)
async def get_pack(pack_id: str) -> FingerspellingPack:
    """One pack by id; 404 when there is no such pack."""
    pack = _packs.get(pack_id)
    if pack is None:
        raise HTTPException(status_code=404, detail=f"no fingerspelling pack {pack_id!r}")
    return pack

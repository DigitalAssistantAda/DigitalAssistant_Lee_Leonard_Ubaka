import re
from typing import Optional


HEX_COLOR_PATTERN = re.compile(r"^#[0-9A-Fa-f]{6}$")


def validate_hex_color(value: Optional[str], field_name: str = "Color") -> Optional[str]:
    if value is None:
        return value
    if not HEX_COLOR_PATTERN.match(value):
        raise ValueError(f"{field_name} must be a hex value like #RRGGBB")
    return value
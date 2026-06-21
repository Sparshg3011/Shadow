"""Find nearby restaurants via Foursquare Places API and generate Yelp reservation URLs.

Parses location, date, time, and covers from the incoming query text, calls the
Foursquare Places Search endpoint, sorts results by rating, and returns up to 5
restaurants as markdown links pointing to Yelp search pages.
"""

import logging
import os
import re
from urllib.parse import quote_plus

import requests

_log = logging.getLogger(__name__)

NUM_RESTAURANTS = 5
FOURSQUARE_SEARCH_URL = "https://places-api.foursquare.com/places/search"
FOURSQUARE_API_VERSION = "2025-06-17"


# ---------------------------------------------------------------------------
# Query parsing helpers
# ---------------------------------------------------------------------------

def _parse_location(text: str) -> str:
    """Extract location from query text."""
    patterns = [
        r"(?:in|near|at|around)\s+([A-Za-z\s,]+?)(?:\s+(?:for|on|at|\d)|\.|$)",
        r"restaurants?\s+(?:in|near|at)\s+([A-Za-z\s,]+?)(?:\s+(?:for|on|at|\d)|\.|$)",
    ]
    for pat in patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            return m.group(1).strip().rstrip(",")
    return "San Francisco"


def _parse_date(text: str) -> str:
    """Extract date as YYYY-MM-DD from query text."""
    # ISO format: 2026-06-21
    m = re.search(r"\b(\d{4}-\d{2}-\d{2})\b", text)
    if m:
        return m.group(1)
    # Written: June 21 2026 / June 21, 2026
    months = {
        "january": "01", "february": "02", "march": "03", "april": "04",
        "may": "05", "june": "06", "july": "07", "august": "08",
        "september": "09", "october": "10", "november": "11", "december": "12",
        "jan": "01", "feb": "02", "mar": "03", "apr": "04",
        "jun": "06", "jul": "07", "aug": "08", "sep": "09",
        "oct": "10", "nov": "11", "dec": "12",
    }
    m = re.search(
        r"\b(january|february|march|april|may|june|july|august|september|"
        r"october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)"
        r"\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b",
        text, re.IGNORECASE,
    )
    if m:
        month = months[m.group(1).lower()]
        day = m.group(2).zfill(2)
        year = m.group(3)
        return f"{year}-{month}-{day}"
    from datetime import date
    return date.today().isoformat()


def _parse_time(text: str) -> str:
    """Extract time as HHMM (24h) from query text."""
    # 24h: 19:00 or 1900
    m = re.search(r"\b([01]?\d|2[0-3]):([0-5]\d)\b", text)
    if m:
        return m.group(1).zfill(2) + m.group(2)
    # 12h: 7pm, 7:30pm, 7 pm
    m = re.search(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b", text, re.IGNORECASE)
    if m:
        hour = int(m.group(1))
        minute = int(m.group(2) or 0)
        if m.group(3).lower() == "pm" and hour != 12:
            hour += 12
        elif m.group(3).lower() == "am" and hour == 12:
            hour = 0
        return f"{hour:02d}{minute:02d}"
    return "1900"


def _parse_covers(text: str) -> int:
    """Extract number of people from query text."""
    patterns = [
        r"(\d+)\s*(?:people|persons?|guests?|covers?|pax)",
        r"(?:for|party of|group of)\s+(\d+)",
        r"table\s+(?:for\s+)?(\d+)",
    ]
    for pat in patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            return int(m.group(1))
    return 2


# ---------------------------------------------------------------------------
# Foursquare Places API search
# ---------------------------------------------------------------------------

def _search_restaurants(location: str) -> list[dict]:
    """Return up to NUM_RESTAURANTS restaurants near location, sorted by rating."""
    api_key = os.environ["FOURSQUARE_API_KEY"]
    params = {
        "query": "restaurant",
        "near": location,
        "limit": NUM_RESTAURANTS,
        "sort": "RATING",
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
        "Accept-Encoding": "identity",
        "X-Places-Api-Version": FOURSQUARE_API_VERSION,
    }
    _log.info("Foursquare Places request: GET %s params=%s key=%s", FOURSQUARE_SEARCH_URL, params, api_key[:8] + "..." if api_key else "MISSING")
    resp = requests.get(FOURSQUARE_SEARCH_URL, params=params, headers=headers, timeout=30)
    _log.info("Foursquare Places response: status=%d body=%s", resp.status_code, resp.text[:500])
    resp.raise_for_status()
    data = resp.json()
    return data.get("results", [])


# ---------------------------------------------------------------------------
# Yelp URL builder
# ---------------------------------------------------------------------------

def _business_slug(name: str, location: str) -> str:
    """Derive a best-effort Yelp business slug from name and city."""
    city = location.split(",")[0].strip().lower()
    slug_name = re.sub(r"[^a-z0-9\s-]", "", name.lower())
    slug_name = re.sub(r"\s+", "-", slug_name.strip())
    city_part = re.sub(r"\s+", "-", city)
    return f"{slug_name}-{city_part}"


def _yelp_url(name: str, location: str, date: str, time: str, covers: int) -> str:
    slug = _business_slug(name, location)
    return (
        f"https://www.yelp.com/reservations/{slug}"
        f"?source=yelp_biz"
        f"&date={date}"
        f"&time={time}"
        f"&covers={covers}"
    )


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def find_restaurants(query: str) -> str:
    """Parse query, search Foursquare Places, return markdown links with Yelp URLs."""
    location = _parse_location(query)
    date = _parse_date(query)
    time = _parse_time(query)
    covers = _parse_covers(query)

    _log.info(
        "Restaurant search: location=%r date=%s time=%s covers=%d",
        location, date, time, covers,
    )

    places = _search_restaurants(location)
    if not places:
        return f"Sorry, I couldn't find restaurants near {location}."

    lines = []
    for place in places:
        name = place.get("name", "Restaurant")
        rating = place.get("rating")
        rating_str = f" ⭐ {rating}" if rating else ""
        address = place.get("location", {}).get("formatted_address", "")
        address_str = f" — {address}" if address else ""
        url = _yelp_url(name, location, date, time, covers)
        lines.append(f"[{name}{rating_str}{address_str}]({url})")

    return "\n".join(lines)

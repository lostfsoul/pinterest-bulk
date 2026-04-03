# Plan: Fix Google Fonts Not Applied on Server

## Problem
When using builtin fonts like "Bebas Neue", "Montserrat", "Oswald", etc. in pin generation:
- **Frontend preview works** - Browser loads Google Fonts via CSS and renders correctly
- **Backend rendering fails** - Node.js canvas cannot access Google Fonts URLs; it silently falls back to system default fonts

The Docker container only has `fonts-dejavu-core` installed. No Google Fonts are available to the Node.js canvas rendering.

## Solution
Download and install the Google Fonts used by the app into the Docker image.

### Fonts to Install
- Bebas Neue
- Montserrat
- Playfair Display
- Oswald
- Poppins

## Implementation

### File: `Dockerfile`

Add a step to download and install Google Fonts before the `RUN mkdir` command:

```dockerfile
# Download and install Google Fonts used by the app
RUN mkdir -p /usr/share/fonts/truetype/google && \
    curl -sL "https://github.com/googlefonts/bebas-neue/raw/main/fonts/BebasNeue-Regular.ttf" -o /usr/share/fonts/truetype/google/BebasNeue-Regular.ttf && \
    curl -sL "https://github.com/googlefonts/montserrat/raw/main/fonts/ttf/Montserrat-Regular.ttf" -o /usr/share/fonts/truetype/google/Montserrat-Regular.ttf && \
    curl -sL "https://github.com/googlefonts/montserrat/raw/main/fonts/ttf/Montserrat-Bold.ttf" -o /usr/share/fonts/truetype/google/Montserrat-Bold.ttf && \
    curl -sL "https://github.com/googlefonts/playfair/raw/main/fonts/ttf/PlayfairDisplay-Regular.ttf" -o /usr/share/fonts/truetype/google/PlayfairDisplay-Regular.ttf && \
    curl -sL "https://github.com/googlefonts/oswald/raw/main/fonts/ttf/Oswald-Regular.ttf" -o /usr/share/fonts/truetype/google/Oswald-Regular.ttf && \
    curl -sL "https://github.com/googlefonts/oswald/raw/main/fonts/ttf/Oswald-Bold.ttf" -o /usr/share/fonts/truetype/google/Oswald-Bold.ttf && \
    curl -sL "https://github.com/googlefonts/poppins/raw/main/fonts/ttf/Poppins-Regular.ttf" -o /usr/share/fonts/truetype/google/Poppins-Regular.ttf && \
    curl -sL "https://github.com/googlefonts/poppins/raw/main/fonts/ttf/Poppins-Bold.ttf" -o /usr/share/fonts/truetype/google/Poppins-Bold.ttf && \
    fc-cache -f && \
    rm -rf /var/lib/apt/lists/*
```

Also add `curl` to the apt-get install list since it's needed to download fonts.

### Changes Summary
1. Add `curl` to apt-get packages
2. Add font download and installation step after apt-get
3. Update `fc-cache` to register the new fonts

## Verification
1. Build Docker image locally
2. Start container and verify fonts exist: `ls /usr/share/fonts/truetype/google/`
3. Run pin generation with "Bebas Neue" font and verify the PNG uses the correct font
4. Deploy to Caprover and test

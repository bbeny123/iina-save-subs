# IINA Userscript - Save subtitles with delay

A user script that adds **Save subtitles with delay** functionality to [IINA media player](https://iina.io/).

## Usage

You can access the **Save subtitles with delay** feature in two ways:

- **Menu**: Plugin → Save subtitles...
- **Keyboard shortcut**: `Cmd + D`

## Features

- Save current **SubRip** (`.srt`) subtitles with customizable delay (in milliseconds)
  - Defaults to current IINA subtitle delay when no delay is entered
- Supports negative delays
  - Automatically removes subtitles that would start before video beginning
- Automatically activates saved subtitles as current track

## Installation

1. Copy the content of [`save-subtitles.js`](save-subtitles.js)
2. Open **IINA → Plugin → Manage User Scripts...** (or press `Cmd + Shift + U`)  
3. Use the copied content to create a new user script  
4. Restart **IINA**

## Requirements

- IINA 1.4.0 or later

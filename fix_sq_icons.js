const Jimp = require('jimp');
const fs = require('fs');
const path = require('path');

async function convertAndResize() {
    try {
        const icon128Path = path.join(__dirname, 'icons', 'icon128.png');
        // We'll read the original icon128.png in git and re-save it properly
        // Wait, first let's make a backup of it so we don't overwrite if it fails
        // or just let it overwrite but re-encode.

        // We'll just read icon128.png
        console.log("Reading icon:", icon128Path);
        const image = await Jimp.read(icon128Path);

        // Save 128x128
        const out128 = image.clone().resize(128, 128);
        await out128.writeAsync(icon128Path); // rewrite properly formatting
        console.log('Saved 128x128');

        // Save 48x48
        const out48 = image.clone().resize(48, 48);
        const p48 = path.join(__dirname, 'icons', 'icon48.png');
        await out48.writeAsync(p48);
        console.log('Saved 48x48');

        // Save 16x16
        const out16 = image.clone().resize(16, 16);
        const p16 = path.join(__dirname, 'icons', 'icon16.png');
        await out16.writeAsync(p16);
        console.log('Saved 16x16');

        console.log("Successfully generated fixed Study Quest icons.");

    } catch (error) {
        console.error("Error processing icons:", error);
    }
}

convertAndResize();

/**
 * PURPOSE: Convert browser clipboard image items into uploadable files for the
 * TUI screenshot action without accepting clipboard text or unrelated data.
 */

export interface ClipboardImageItem {
  types: readonly string[];
  getType: (type: string) => Promise<Blob>;
}

export interface ClipboardImageReader {
  read: () => Promise<ClipboardImageItem[]>;
}

/**
 * Choose a conventional filename extension for one clipboard image MIME type.
 */
function resolveClipboardImageExtension(mimeType: string): string {
  const subtype = mimeType.split('/')[1]?.toLowerCase() || 'png';
  const normalizedSubtype = subtype.split('+')[0].replace(/[^a-z0-9]/g, '');
  if (normalizedSubtype === 'jpeg') {
    return 'jpg';
  }
  return normalizedSubtype || 'png';
}

/**
 * Read only image payloads and return files accepted by the existing upload API.
 */
export async function readClipboardImageFiles(reader: ClipboardImageReader): Promise<File[]> {
  const clipboardItems = await reader.read();
  const imageFiles: File[] = [];

  for (const clipboardItem of clipboardItems) {
    const imageType = clipboardItem.types.find((type) => type.startsWith('image/'));
    if (!imageType) {
      continue;
    }

    const imageBlob = await clipboardItem.getType(imageType);
    const extension = resolveClipboardImageExtension(imageType);
    imageFiles.push(new File(
      [imageBlob],
      `clipboard-image-${imageFiles.length + 1}.${extension}`,
      { type: imageType, lastModified: Date.now() },
    ));
  }

  return imageFiles;
}

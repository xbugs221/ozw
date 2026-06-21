/**
 * PURPOSE: Keep image assets on a visual preview path when they reach the
 * editor workflow from sources other than the file-tree modal.
 */
import { useEffect, useState } from 'react';
import { authenticatedFetch } from '../../../../utils/api';
import { formatPathRelativeToProject } from '../../../../utils/pathDisplay';
import ZoomableImagePreview from '../../../image-preview/ZoomableImagePreview';

type CodeEditorImagePreviewProps = {
  projectName: string;
  fileName: string;
  filePath: string;
  projectPath?: string;
  loadingLabel: string;
  errorLabel: string;
  labels: {
    zoomIn: string;
    zoomOut: string;
    resetZoom: string;
    enterFullscreen: string;
    exitFullscreen: string;
  };
};

export default function CodeEditorImagePreview({
  projectName,
  fileName,
  filePath,
  projectPath,
  loadingLabel,
  errorLabel,
  labels,
}: CodeEditorImagePreviewProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const displayPath = formatPathRelativeToProject(filePath, projectPath);

  useEffect(() => {
    let objectUrl: string | null = null;
    const controller = new AbortController();

    /**
     * Load the preview as raw bytes so the browser decodes the real image.
     */
    const loadImage = async () => {
      try {
        setError(null);
        setImageUrl(null);
        const imageQuery = new URLSearchParams({ path: filePath });
        if (projectPath) {
          imageQuery.set('projectPath', projectPath);
        }

        const response = await authenticatedFetch(
          `/api/projects/${projectName}/files/content?${imageQuery.toString()}`,
          { signal: controller.signal },
        );

        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        objectUrl = URL.createObjectURL(await response.blob());
        setImageUrl(objectUrl);
      } catch (loadError) {
        if (loadError instanceof Error && loadError.name === 'AbortError') {
          return;
        }
        console.error('Error loading image preview:', loadError);
        setError(errorLabel);
      }
    };

    void loadImage();

    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [errorLabel, filePath, projectName, projectPath]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-muted/30 px-6 py-8">
        <div className="rounded-lg border border-border bg-background px-5 py-4">
          <p className="text-sm text-destructive">{error}</p>
          <p className="mt-3 break-all text-xs text-muted-foreground">{displayPath}</p>
        </div>
      </div>
    );
  }

  if (!imageUrl) {
    return (
      <div className="flex h-full items-center justify-center bg-muted/30 px-6 py-8">
        <p className="text-sm text-muted-foreground">{loadingLabel}</p>
      </div>
    );
  }

  return (
    <ZoomableImagePreview
      src={imageUrl}
      alt={fileName}
      className="h-full"
      imageClassName="rounded-md shadow-sm"
      labels={labels}
    />
  );
}

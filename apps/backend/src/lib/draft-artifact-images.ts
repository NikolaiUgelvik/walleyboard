type MarkdownImageReference = {
  href: string;
  normalizedHref: string;
  markdown: string;
};

const markdownImagePattern = /!\[[^\]]*]\(([^)\s]+)\)/g;

function normalizeHref(href: string): string {
  try {
    return new URL(href, "http://walleyboard.local").pathname;
  } catch {
    return href;
  }
}

function collectMarkdownImages(content: string): MarkdownImageReference[] {
  const images: MarkdownImageReference[] = [];

  for (const match of content.matchAll(markdownImagePattern)) {
    const markdown = match[0];
    const href = match[1];

    if (typeof markdown !== "string" || typeof href !== "string") {
      continue;
    }

    images.push({
      href,
      normalizedHref: normalizeHref(href),
      markdown,
    });
  }

  return images;
}

function isDraftArtifactImageHref(
  normalizedHref: string,
  projectId: string,
  artifactScopeId: string,
): boolean {
  return normalizedHref.startsWith(
    `/projects/${projectId}/draft-artifacts/${artifactScopeId}/`,
  );
}

export function preserveDraftArtifactImages(input: {
  artifactScopeId: string;
  originalDescription: string;
  projectId: string;
  refinedDescription: string;
}): string {
  const originalArtifactImages = collectMarkdownImages(
    input.originalDescription,
  ).filter((image) =>
    isDraftArtifactImageHref(
      image.normalizedHref,
      input.projectId,
      input.artifactScopeId,
    ),
  );

  if (originalArtifactImages.length === 0) {
    return input.refinedDescription;
  }

  const refinedArtifactImageCounts = new Map<string, number>();
  for (const image of collectMarkdownImages(input.refinedDescription)) {
    if (
      !isDraftArtifactImageHref(
        image.normalizedHref,
        input.projectId,
        input.artifactScopeId,
      )
    ) {
      continue;
    }

    refinedArtifactImageCounts.set(
      image.normalizedHref,
      (refinedArtifactImageCounts.get(image.normalizedHref) ?? 0) + 1,
    );
  }

  const missingImages: string[] = [];
  for (const image of originalArtifactImages) {
    const remainingCount = refinedArtifactImageCounts.get(image.normalizedHref);

    if (remainingCount && remainingCount > 0) {
      refinedArtifactImageCounts.set(image.normalizedHref, remainingCount - 1);
      continue;
    }

    missingImages.push(image.markdown);
  }

  if (missingImages.length === 0) {
    return input.refinedDescription;
  }

  const trimmedDescription = input.refinedDescription.replace(/\s+$/u, "");
  const separator = trimmedDescription.length > 0 ? "\n\n" : "";

  return `${trimmedDescription}${separator}${missingImages.join("\n\n")}`;
}

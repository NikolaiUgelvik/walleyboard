import assert from "node:assert/strict";
import test from "node:test";

import { preserveDraftArtifactImages } from "./draft-artifact-images.js";

test("appends missing draft artifact images back into refined descriptions", () => {
  const originalDescription = [
    "Explain the UI issue.",
    "",
    "![Pasted screenshot](/projects/project-1/draft-artifacts/scope-1/one.png)",
    "",
    "More context.",
    "",
    "![Pasted screenshot](/projects/project-1/draft-artifacts/scope-1/two.png)",
  ].join("\n");

  const result = preserveDraftArtifactImages({
    projectId: "project-1",
    artifactScopeId: "scope-1",
    originalDescription,
    refinedDescription: "Refined description with clearer wording.",
  });

  assert.equal(
    result,
    [
      "Refined description with clearer wording.",
      "",
      "![Pasted screenshot](/projects/project-1/draft-artifacts/scope-1/one.png)",
      "",
      "![Pasted screenshot](/projects/project-1/draft-artifacts/scope-1/two.png)",
    ].join("\n"),
  );
});

test("does not duplicate draft artifact images that still render as images", () => {
  const originalDescription =
    "![Pasted screenshot](/projects/project-1/draft-artifacts/scope-1/one.png)";

  const result = preserveDraftArtifactImages({
    projectId: "project-1",
    artifactScopeId: "scope-1",
    originalDescription,
    refinedDescription:
      "Updated wording.\n\n![Updated alt](http://127.0.0.1:4000/projects/project-1/draft-artifacts/scope-1/one.png)",
  });

  assert.equal(
    result,
    "Updated wording.\n\n![Updated alt](http://127.0.0.1:4000/projects/project-1/draft-artifacts/scope-1/one.png)",
  );
});

test("ignores non-artifact image references from the original draft", () => {
  const originalDescription = [
    "Keep the pasted screenshot only.",
    "",
    "![External image](https://example.com/image.png)",
    "",
    "![Pasted screenshot](/projects/project-1/draft-artifacts/scope-1/one.png)",
  ].join("\n");

  const result = preserveDraftArtifactImages({
    projectId: "project-1",
    artifactScopeId: "scope-1",
    originalDescription,
    refinedDescription: "Refined description.",
  });

  assert.equal(
    result,
    [
      "Refined description.",
      "",
      "![Pasted screenshot](/projects/project-1/draft-artifacts/scope-1/one.png)",
    ].join("\n"),
  );
});

import { Badge, createTheme } from "@mantine/core";

export const walleyboardTheme = createTheme({
  primaryColor: "orange",
  defaultRadius: "md",
  fontFamily: "'IBM Plex Sans', 'Avenir Next', 'Segoe UI', sans-serif",
  fontFamilyMonospace: "'IBM Plex Mono', 'SFMono-Regular', monospace",
  headings: {
    fontFamily: "'IBM Plex Sans', 'Avenir Next', 'Segoe UI', sans-serif",
  },
  colors: {
    slate: [
      "#f7f8f9",
      "#eef0f3",
      "#d9dee4",
      "#bcc6d2",
      "#9aaaae",
      "#7a8594",
      "#5f6b7c",
      "#475263",
      "#2f3949",
      "#182230",
    ],
  },
  primaryShade: 6,
  components: {
    Badge: Badge.extend({
      styles: {
        label: {
          lineHeight: 1.15,
          textBoxEdge: "unset",
          textBoxTrim: "unset",
        },
        root: {
          height: "auto",
          minHeight: "var(--badge-height)",
          lineHeight: 1.15,
          overflow: "visible",
          paddingBlock: "calc(0.0625rem * var(--mantine-scale))",
        },
      },
    }),
  },
});

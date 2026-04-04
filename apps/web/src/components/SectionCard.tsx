import { Card, Stack, Text, Title } from "@mantine/core";
import type { ReactNode } from "react";

type SectionCardProps = {
  title?: string;
  description?: string;
  children: ReactNode;
};

export function SectionCard({
  title,
  description,
  children,
}: SectionCardProps) {
  return (
    <Card
      withBorder
      radius="lg"
      padding="md"
      shadow="xs"
      style={{
        background: "var(--walleyboard-panel)",
        borderColor: "var(--walleyboard-border)",
        boxShadow: "var(--walleyboard-shadow)",
      }}
    >
      <Stack gap="md">
        {title || description ? (
          <Stack gap={4}>
            {title ? (
              <Title order={4} style={{ letterSpacing: "-0.03em" }}>
                {title}
              </Title>
            ) : null}
            {description ? (
              <Text c="dimmed" size="sm">
                {description}
              </Text>
            ) : null}
          </Stack>
        ) : null}
        {children}
      </Stack>
    </Card>
  );
}

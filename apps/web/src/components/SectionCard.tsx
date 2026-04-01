import { Card, Stack, Text, Title } from "@mantine/core";
import type { ReactNode } from "react";

type SectionCardProps = {
  title: string;
  description?: string;
  children: ReactNode;
};

export function SectionCard({ title, description, children }: SectionCardProps) {
  return (
    <Card
      withBorder
      radius="lg"
      padding="md"
      shadow="xs"
      style={{
        background: "var(--orchestrator-panel)",
        borderColor: "var(--orchestrator-border)",
        boxShadow: "var(--orchestrator-shadow)"
      }}
    >
      <Stack gap="md">
        <Stack gap={4}>
          <Title order={4} style={{ letterSpacing: "-0.03em" }}>
            {title}
          </Title>
          {description ? (
            <Text c="dimmed" size="sm">
              {description}
            </Text>
          ) : null}
        </Stack>
        {children}
      </Stack>
    </Card>
  );
}

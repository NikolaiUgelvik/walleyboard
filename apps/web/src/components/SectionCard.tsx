import { Card, Stack, Text, Title } from "@mantine/core";
import type { ReactNode } from "react";

type SectionCardProps = {
  title: string;
  description: string;
  children: ReactNode;
};

export function SectionCard({ title, description, children }: SectionCardProps) {
  return (
    <Card withBorder radius="md" padding="lg">
      <Stack gap="md">
        <Stack gap={4}>
          <Title order={3}>{title}</Title>
          <Text c="dimmed" size="sm">
            {description}
          </Text>
        </Stack>
        {children}
      </Stack>
    </Card>
  );
}

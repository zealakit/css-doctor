import { EmptyState, PageHeader } from "@/components/ui";

type PlaceholderScreenProps = {
  title: string;
  description: string;
  nextStep: string;
};

export function PlaceholderScreen({
  title,
  description,
  nextStep,
}: PlaceholderScreenProps) {
  return (
    <section>
      <PageHeader title={title} description={description} />
      <EmptyState title="Not wired yet" description={nextStep} />
    </section>
  );
}

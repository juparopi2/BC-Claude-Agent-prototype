import { MainLayout } from '@/components/layout';
import { SourcePanel } from '@/components/panels';

export default function Home() {
  return (
    <MainLayout
      showSourcePanel={true}
      sourcePanel={<SourcePanel />}
    />
  );
}

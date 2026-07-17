import type { ReactNode } from 'react';
import { ExperimentShell } from './components/ExperimentShell';
import { ExperimentProvider } from './hooks/useExperimentState';

export default function ExperimentsLayout({ children }: { children: ReactNode }) {
  return (
    <ExperimentProvider>
      <ExperimentShell>
        {children}
      </ExperimentShell>
    </ExperimentProvider>
  );
}

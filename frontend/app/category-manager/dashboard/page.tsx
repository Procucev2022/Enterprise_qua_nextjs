import type { Metadata } from 'next';
import DashboardView from './DashboardView';

export const metadata: Metadata = {
  title: 'Dashboard | Category Manager',
  description: 'Executive KPI metrics, live database pipeline trends, and activity tracking',
};

export default function CategoryManagerDashboardPage() {
  return <DashboardView />;
}

import { getDemoBootstrap } from "@/apps/tunee/lib/bootstrap";
import { TuneeDemoApp } from "@/apps/tunee/components/tunee-demo-app";

export default async function TuneePage(): Promise<React.JSX.Element> {
  const initialData = await getDemoBootstrap();
  return <TuneeDemoApp initialData={initialData} />;
}

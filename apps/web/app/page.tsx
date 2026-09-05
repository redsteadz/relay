import { ComparisonTable } from "../components/ComparisonTable";
import { DataFlowMatrix } from "../components/DataFlowMatrix";
import { ExplainableReceipt } from "../components/ExplainableReceipt";
import { Faq } from "../components/Faq";
import { Footer } from "../components/Footer";
import { Hero } from "../components/Hero";
import { InstallBlock } from "../components/InstallBlock";
import { Nav } from "../components/Nav";
import { PipelinePlate } from "../components/PipelinePlate";
import { QuietCounters } from "../components/QuietCounters";
import { RulesPlate } from "../components/RulesPlate";
import { StatusLine } from "../components/StatusLine";
import { ThemeToggle } from "../components/theme/ThemeToggle";
import { landing } from "../content/landing";

export default function LandingPage() {
  return (
    <>
      <Nav {...landing.nav} actions={<ThemeToggle {...landing.themeToggle} />} />
      <main id="main">
        <Hero {...landing.hero} aside={<ExplainableReceipt {...landing.receipt} />} />
        <PipelinePlate {...landing.pipeline} />
        <RulesPlate {...landing.rules} />
        <DataFlowMatrix {...landing.dataFlow} />
        <QuietCounters {...landing.quiet} />
        <ComparisonTable {...landing.comparison} />
        <InstallBlock {...landing.install} />
        <StatusLine {...landing.status} />
        <Faq {...landing.faq} />
      </main>
      <Footer {...landing.footer} />
    </>
  );
}

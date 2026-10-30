import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { CtaBand } from "@/components/landing/CtaBand";
import { Faq } from "@/components/landing/Faq";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { FeaturedIndexes } from "@/components/landing/LiveData";
import { Section } from "@/components/landing/Section";
import { Security } from "@/components/landing/Security";

export default function LandingPage() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <Hero />
        <Section id="indexes" eyebrow="Live indexes" title="Curated baskets, live on-chain" intro="Each index is a different risk and yield profile. TVL, allocation and realised APY below are read directly from the contracts.">
          <FeaturedIndexes />
        </Section>
        <HowItWorks />
        <Security />
        <Faq />
        <CtaBand />
      </main>
      <SiteFooter />
    </>
  );
}

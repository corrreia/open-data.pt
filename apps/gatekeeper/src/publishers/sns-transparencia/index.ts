import type { PublisherDefinition } from "#/catalog/define";
import { FEED as birthsAndCaesareans } from "./feeds/births-and-caesareans";
import { FEED as bloodCollection } from "./feeds/blood-collection";
import { FEED as cancerScreening } from "./feeds/cancer-screening";
import { FEED as continuingCareWaiting } from "./feeds/continuing-care-waiting";
import { FEED as dailyDeathCertificates } from "./feeds/daily-death-certificates";
import { FEED as dispensedMedicines } from "./feeds/dispensed-medicines";
import { FEED as emergencyCallsTransferredSns24 } from "./feeds/emergency-calls-transferred-sns24";
import { FEED as emergencyTriage } from "./feeds/emergency-triage";
import { FEED as firstConsultationsWithinTarget } from "./feeds/first-consultations-within-target";
import { FEED as genericMedicineDispensing } from "./feeds/generic-medicine-dispensing";
import { FEED as healthFrameworkAgreements } from "./feeds/health-framework-agreements";
import { FEED as healthProcurement } from "./feeds/health-procurement";
import { FEED as hospitalBedsByType } from "./feeds/hospital-beds-by-type";
import { FEED as hospitalEmergencyAttendances } from "./feeds/hospital-emergency-attendances";
import { FEED as hospitalOccupancy } from "./feeds/hospital-occupancy";
import { FEED as icaroHeatIndex } from "./feeds/icaro-heat-index";
import { FEED as inemDispatches } from "./feeds/inem-dispatches";
import { FEED as inemEmergencyCalls } from "./feeds/inem-emergency-calls";
import { FEED as inemOccurrencesByPriority } from "./feeds/inem-occurrences-by-priority";
import { FEED as legionellaEnvironmentalMonitoring } from "./feeds/legionella-environmental-monitoring";
import { FEED as licensedPublicDefibrillatorProgrammes } from "./feeds/licensed-public-defibrillator-programmes";
import { FEED as lvtHospitalMorbidityMortality } from "./feeds/lvt-hospital-morbidity-mortality";
import { FEED as medicalSpecialtyTrainingVacancies } from "./feeds/medical-specialty-training-vacancies";
import { FEED as medicinePackagePrices } from "./feeds/medicine-package-prices";
import { FEED as newbornScreening } from "./feeds/newborn-screening";
import { FEED as poisonInformationCalls } from "./feeds/poison-information-calls";
import { FEED as pregnancyLineTriage } from "./feeds/pregnancy-line-triage";
import { FEED as primaryCareConsultationAccess } from "./feeds/primary-care-consultation-access";
import { FEED as primaryCareFluConsultations } from "./feeds/primary-care-flu-consultations";
import { FEED as psychologyConsultations } from "./feeds/psychology-consultations";
import { FEED as seasonalFluVaccinationCoverage } from "./feeds/seasonal-flu-vaccination-coverage";
import { FEED as sicknessSelfDeclarations } from "./feeds/sickness-self-declarations";
import { FEED as supplierDebtAndArrears } from "./feeds/supplier-debt-and-arrears";
import { FEED as surgeryWaitingTarget } from "./feeds/surgery-waiting-target";

export const PUBLISHER: PublisherDefinition = {
  name: "SNS Transparência",
  url: "https://transparencia.sns.gov.pt/",
  sources: ["transparencia.sns.gov.pt"],
  logo: "png",
  feeds: [
    birthsAndCaesareans,
    bloodCollection,
    cancerScreening,
    continuingCareWaiting,
    dailyDeathCertificates,
    dispensedMedicines,
    emergencyCallsTransferredSns24,
    emergencyTriage,
    firstConsultationsWithinTarget,
    genericMedicineDispensing,
    healthFrameworkAgreements,
    healthProcurement,
    hospitalBedsByType,
    hospitalEmergencyAttendances,
    hospitalOccupancy,
    icaroHeatIndex,
    inemDispatches,
    inemEmergencyCalls,
    inemOccurrencesByPriority,
    legionellaEnvironmentalMonitoring,
    licensedPublicDefibrillatorProgrammes,
    lvtHospitalMorbidityMortality,
    medicalSpecialtyTrainingVacancies,
    medicinePackagePrices,
    newbornScreening,
    poisonInformationCalls,
    pregnancyLineTriage,
    primaryCareConsultationAccess,
    primaryCareFluConsultations,
    psychologyConsultations,
    seasonalFluVaccinationCoverage,
    sicknessSelfDeclarations,
    supplierDebtAndArrears,
    surgeryWaitingTarget,
  ],
};

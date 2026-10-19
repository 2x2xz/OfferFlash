/** Fixed public read query reviewed from Ashby's own application bundle.
 * Source: https://cdn.ashbyprd.com/frontend_non_user/16b35231c2987e4ba1c5d9a0e165a2d03c91a468/assets/index-D0HZ41J-.js
 * Bundle SHA-256: 992bc22a1c0fc1a1d2822e7f5c791618208810813730075a89be07c801d47aee
 * ApiJobPosting query AST only; never execute the vendor bundle. Apollo's
 * __typename selections are included. Public read response verified HTTP 200
 * on 2026-10-18, without candidate data. Harness-only, not model instructions.
 */
export const REVIEWED_ASHBY_QUERY_TOKEN_SHA256 = "172706180d50e063016b3aed0e7a45bf46ec3259ca0a64e795f8c8ac3efd7e87";
export const REVIEWED_ASHBY_QUERY = `query ApiJobPosting($organizationHostedJobsPageName: String!, $jobPostingId: String!) {
  jobPosting(organizationHostedJobsPageName: $organizationHostedJobsPageName, jobPostingId: $jobPostingId) {
    ...JobPostingDetailParts
    applicationForm {
      ...FormRenderParts
      __typename
    }
    surveyForms {
      ...FormRenderParts
      __typename
    }
    recaptchaAction
    __typename
  }
}

fragment JSONBoxParts on JSONBox {
  value
  __typename
}

fragment FileParts on File {
  id
  filename
  __typename
}

fragment FormFieldEntryParts on FormFieldEntry {
  id
  field
  fieldValue {
    ... on JSONBox {
      ...JSONBoxParts
      __typename
    }
    ... on File {
      ...FileParts
      __typename
    }
    ... on FileList {
      files {
        ...FileParts
        __typename
      }
      __typename
    }
    __typename
  }
  isRequired
  descriptionHtml
  isHidden
  __typename
}

fragment JobPostingDetailParts on JobPostingDetails {
  id
  title
  departmentName
  departmentExternalName
  locationName
  locationAddress
  workplaceType
  employmentType
  descriptionHtml
  isListed
  isConfidential
  teamNames
  secondaryLocationNames
  compensationTierSummary
  compensationTiers {
    id
    title
    tierSummary
    __typename
  }
  applicationDeadline
  compensationTierGuideUrl
  scrapeableCompensationSalarySummary
  compensationPhilosophyHtml
  applicationLimitCalloutHtml
  shouldAskForTextingConsent
  shouldAskForWhatsAppConsent
  candidateTextingPrivacyPolicyUrl
  candidateTextingTermsAndConditionsUrl
  legalEntityNameForTextingConsent
  automatedProcessingLegalNotice {
    automatedProcessingLegalNoticeRuleId
    automatedProcessingLegalNoticeHtml
    __typename
  }
  __typename
}

fragment FormRenderParts on FormRender {
  id
  formControls {
    identifier
    title
    __typename
  }
  errorMessages
  formErrors {
    message
    fieldEntryId
    __typename
  }
  sections {
    title
    descriptionHtml
    fieldEntries {
      ...FormFieldEntryParts
      __typename
    }
    isHidden
    __typename
  }
  sourceFormDefinitionId
  __typename
}`;

/** The same public bundle's organization/theme read. Current non-embedded
 * /oakslab/:jobPostingId/application route supplies searchContext JobPosting.
 * Exact query hash also matches the browser's blocked read-only request.
 */
export const REVIEWED_ASHBY_ORGANIZATION_QUERY_TOKEN_SHA256 = '688911132a84676bdf706a2a02e5c00ee8be83fa20da0003778fff05c7570847';
export const REVIEWED_ASHBY_ORGANIZATION_QUERY = `query ApiOrganizationFromHostedJobsPageName($organizationHostedJobsPageName: String!, $searchContext: OrganizationSearchContext) {
  organization: organizationFromHostedJobsPageName(organizationHostedJobsPageName: $organizationHostedJobsPageName, searchContext: $searchContext) {
    ...OrganizationParts
    __typename
  }
}

fragment OrganizationParts on Organization {
  organizationId
  name
  publicWebsite
  customJobsPageUrl
  hostedJobsPageSlug
  allowJobPostIndexing
  isDemoOrg
  theme {
    colors
    showJobFilters
    showLocationAddress
    showTeams
    showAutofillApplicationsBox
    logoWordmarkImageUrl
    logoSquareImageUrl
    applicationSubmittedSuccessMessage
    jobBoardTopDescriptionHtml
    jobBoardBottomDescriptionHtml
    jobPostingBackUrl
    __typename
  }
  appConfirmationTrackingPixelHtml
  recruitingPrivacyPolicyUrl
  activeFeatureFlags
  timezone
  candidateScheduleCancellationReasonRequirementStatus
  showCookieBanner
  __typename
}`;

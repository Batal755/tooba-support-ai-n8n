// Merge PATCH response (updated draft) with Extract AI Reply data.
// Falls back to POST createReply response id if PATCH response has no id.

const patchResult = $input.first().json;
const createResult = $('📝 Create Outlook Draft').first().json;
const aiData = $('🔍 Extract AI Reply').first().json;

const outlookDraftId = patchResult?.id || createResult?.id || null;
const outlookDraftWebLink = patchResult?.webLink || createResult?.webLink || null;
const outlookBodyUpdated = !!(patchResult?.id && !patchResult?.error);
const outlookCreated = !!outlookDraftId;

return [{
  json: {
    ...aiData,
    outlookDraftId,
    outlookDraftWebLink,
    outlookBodyUpdated,
    outlookCreated
  }
}];

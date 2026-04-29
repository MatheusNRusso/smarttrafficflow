
/** * A set of line numbers that are single direction lines.
 * These lines only have one direction, so we can skip the direction selection step for them.
 * This improves the user experience by reducing unnecessary steps for these lines.
 */
export const SINGLE_DIRECTION_LINES = new Set([
    "010", "110", "161", "181", "2918", "349", "385", "443", "444", "460",
    "461", "484", "518", "519", "583", "584", "621", "622", "651", "652",
    "741", "743", "821", "822", "829", "843", "844", "848", "851", "852",
    "862", "863", "866", "872", "892", "894", "950", "951", "955", "957",
    "987", "lecd116", "sn821", "sn848", "sn895", "sp309", "sp315", "sp343",
    "sp404", "sp485", "sp553", "sp766", "sp805", "spa483", "spb483", "sv483", "sv908"
]);

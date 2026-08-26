import { convertToCSV } from "@/lib/analytics/utils/convert-to-csv";
import { formatPartnersForExport } from "@/lib/api/partners/format-partners-for-export";
import { getPartners } from "@/lib/api/partners/get-partners";
import { getPartnersCount } from "@/lib/api/partners/get-partners-count";
import { getDefaultProgramIdOrThrow } from "@/lib/api/programs/get-default-program-id-or-throw";
import { withWorkspace } from "@/lib/auth";
import { qstash } from "@/lib/cron";
import { partnersExportQuerySchema } from "@/lib/zod/schemas/partners";
import { APP_DOMAIN_WITH_NGROK } from "@dub/utils";
import { NextResponse } from "next/server";

const MAX_PARTNERS_TO_EXPORT = 1000;

// GET /api/partners/export – export partners to CSV
export const GET = withWorkspace(
  async ({ searchParams, workspace, session }) => {
    const programId = getDefaultProgramIdOrThrow(workspace);

    const parsedParams = partnersExportQuerySchema.parse(searchParams);
    const { columns, ...filters } = parsedParams;

    // The database path, like the export below, so this count sizes the same
    // result set the export will produce.
    const partnersCount = await getPartnersCount<number>(
      {
        ...filters,
        groupBy: undefined,
        programId,
      },
      { searchProvider: null },
    );

    // Process the export in the background if the number of partners is greater than MAX_PARTNERS_TO_EXPORT
    if (partnersCount > MAX_PARTNERS_TO_EXPORT) {
      await qstash.publishJSON({
        url: `${APP_DOMAIN_WITH_NGROK}/api/cron/export/partners`,
        body: {
          ...parsedParams,
          columns: columns.join(","),
          programId,
          userId: session.user.id,
        },
      });

      return NextResponse.json({}, { status: 202 });
    }

    // Search stays on the database path: the provider truncates at its
    // candidate ceiling, and a file that silently lost rows is worse than one
    // searched over fewer fields.
    const partners = await getPartners(
      {
        ...filters,
        page: 1,
        pageSize: MAX_PARTNERS_TO_EXPORT,
        programId,
        includeGroup: columns.includes("group"),
      },
      { searchProvider: null },
    );

    const formattedPartners = formatPartnersForExport(partners, columns);

    return new Response(convertToCSV(formattedPartners), {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment",
      },
    });
  },
  {
    requiredPlan: ["business", "advanced", "enterprise"],
  },
);

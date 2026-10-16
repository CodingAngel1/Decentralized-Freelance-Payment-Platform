/**
 * jobs.ts
 *
 * GET  /api/jobs          — list jobs (filterable by status, client, freelancer)
 * POST /api/jobs          — create a job (off-chain record; escrow funded separately)
 * GET  /api/jobs/:id      — get single job with milestones
 * PUT  /api/jobs/:id/assign — client assigns a freelancer
 */

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { AppError } from "../middleware/errorHandler";
import {
  formatAmount,
  getAsset,
  sumAmounts,
  toBaseUnits,
  UnknownAssetError,
  type AssetInfo,
} from "../lib/assets";
import { createJobSchema, createProposalSchema, createDeliverableSchema } from "../lib/schemas";

export const jobsRouter = Router();

// GET /api/jobs
jobsRouter.get("/", async (req, res, next) => {
  try {
    const { status, client, freelancer, q, sort, page = "1", limit = "20" } = req.query;

    const searchFilter =
      q && typeof q === "string" && q.trim().length > 0
        ? {
            OR: [
              { title: { contains: q.trim(), mode: "insensitive" as const } },
              { description: { contains: q.trim(), mode: "insensitive" as const } },
            ],
          }
        : {};

    let orderBy: Record<string, "asc" | "desc"> = { createdAt: "desc" };
    if (sort === "oldest" || sort === "created_asc" || sort === "createdAt:asc") {
      orderBy = { createdAt: "asc" };
    } else if (
      sort === "amount_desc" ||
      sort === "highest_amount" ||
      sort === "totalAmountUsdc:desc"
    ) {
      orderBy = { totalAmountUsdc: "desc" };
    } else if (
      sort === "amount_asc" ||
      sort === "lowest_amount" ||
      sort === "totalAmountUsdc:asc"
    ) {
      orderBy = { totalAmountUsdc: "asc" };
    } else if (
      sort === "newest" ||
      sort === "created_desc" ||
      sort === "createdAt:desc"
    ) {
      orderBy = { createdAt: "desc" };
    }

    const jobs = await prisma.job.findMany({
      where: {
        ...(status ? { status: String(status) as any } : {}),
        ...(client ? { client: { stellarAddress: String(client) } } : {}),
        ...(freelancer ? { freelancer: { stellarAddress: String(freelancer) } } : {}),
        ...searchFilter,
      },
      include: { milestones: true, client: true, freelancer: true },
      orderBy,
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    });
    res.json(jobs);
  } catch (err) {
    next(err);
  }
});

// POST /api/jobs
jobsRouter.post("/", requireAuth, validate(createJobSchema), async (req, res, next) => {
  try {
    const { title, description, milestones, expiresAt, asset } = req.body as z.infer<
      typeof createJobSchema
    >;

    let assetInfo: AssetInfo;
    try {
      assetInfo = getAsset(asset);
    } catch (err) {
      if (err instanceof UnknownAssetError) throw new AppError(400, err.message);
      throw err;
    }

    const client = await prisma.user.findUnique({
      where: { stellarAddress: res.locals.stellarAddress },
    });
    if (!client) throw new AppError(404, "User not found — call /api/users/auth first");

    // Sum in the asset's integer base units and format once. Adding whole-unit
    // decimals as JavaScript numbers carries float error into the DECIMAL(65,30)
    // column: two `0.1` milestones became `0.30000000000000004`, which is what
    // GET /api/jobs then returned and the dashboard displayed.
    const totalAmountUsdc = formatAmount(
      sumAmounts(milestones.map((m) => m.amountUsdc), assetInfo.decimals),
      assetInfo.decimals,
    );

    const job = await prisma.job.create({
      data: {
        title,
        description,
        asset: assetInfo.symbol,
        totalAmountUsdc,
        clientId: client.id,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
        milestones: {
          create: milestones.map((m, i) => ({
            index: i,
            // Store each amount at the asset's own precision so the milestones
            // and the total are consistent with the on-chain base units.
            amountUsdc: formatAmount(
              toBaseUnits(m.amountUsdc, assetInfo.decimals),
              assetInfo.decimals,
            ),
            description: m.description,
            deadline: m.deadline ? new Date(m.deadline) : undefined,
          })),
        },
      },
      include: { milestones: true },
    });

    res.status(201).json(job);
  } catch (err) {
    next(err);
  }
});

// GET /api/jobs/:id
jobsRouter.get("/:id", async (req, res, next) => {
  try {
    const job = await prisma.job.findUnique({
      where: { id: req.params.id },
      include: {
        milestones: {
          include: {
            deliverables: {
              include: { uploadedBy: true },
              orderBy: { createdAt: "desc" },
            },
          },
          orderBy: { index: "asc" },
        },
        client: true,
        freelancer: true,
        disputes: true,
        ratings: true,
        proposals: { include: { freelancer: true }, orderBy: { createdAt: "desc" } },
      },
    });
    if (!job) throw new AppError(404, "Job not found");
    res.json(job);
  } catch (err) {
    next(err);
  }
});

// POST /api/jobs/:id/proposals
jobsRouter.post("/:id/proposals", requireAuth, validate(createProposalSchema), async (req, res, next) => {
  try {
    const job = await prisma.job.findUnique({
      where: { id: req.params.id },
      include: { client: true },
    });
    if (!job) throw new AppError(404, "Job not found");

    if (job.client.stellarAddress === res.locals.stellarAddress) {
      throw new AppError(400, "Client cannot apply to their own job");
    }

    if (job.freelancerId || job.status !== "CREATED") {
      throw new AppError(400, "Job is not open for proposals");
    }

    const freelancer = await prisma.user.upsert({
      where: { stellarAddress: res.locals.stellarAddress },
      create: { stellarAddress: res.locals.stellarAddress },
      update: {},
    });

    const { coverLetter, proposedRate } = req.body as {
      coverLetter?: string;
      proposedRate?: string | number;
    };

    try {
      const proposal = await prisma.proposal.create({
        data: {
          jobId: job.id,
          freelancerId: freelancer.id,
          coverLetter,
          proposedRate: proposedRate !== undefined ? String(proposedRate) : undefined,
        },
        include: { freelancer: true },
      });
      res.status(201).json(proposal);
    } catch (e: any) {
      if (e?.code === "P2002") {
        throw new AppError(409, "You have already applied for this job");
      }
      throw e;
    }
  } catch (err) {
    next(err);
  }
});

// GET /api/jobs/:id/proposals
jobsRouter.get("/:id/proposals", async (req, res, next) => {
  try {
    const proposals = await prisma.proposal.findMany({
      where: { jobId: req.params.id },
      include: { freelancer: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(proposals);
  } catch (err) {
    next(err);
  }
});

// PUT /api/jobs/:id/assign
jobsRouter.put("/:id/assign", requireAuth, async (req, res, next) => {
  try {
    const job = await prisma.job.findUnique({ where: { id: req.params.id }, include: { client: true } });
    if (!job) throw new AppError(404, "Job not found");
    if (job.client.stellarAddress !== res.locals.stellarAddress) {
      throw new AppError(403, "Only the client can assign a freelancer");
    }

    const { freelancerAddress } = req.body as { freelancerAddress: string };
    const freelancer = await prisma.user.findUnique({ where: { stellarAddress: freelancerAddress } });
    if (!freelancer) throw new AppError(404, "Freelancer not found");

    const updated = await prisma.job.update({
      where: { id: req.params.id },
      data: { freelancerId: freelancer.id },
    });

    // Accept selected proposal and reject other pending proposals
    await prisma.proposal.updateMany({
      where: { jobId: job.id, freelancerId: freelancer.id },
      data: { status: "ACCEPTED" },
    });
    await prisma.proposal.updateMany({
      where: { jobId: job.id, freelancerId: { not: freelancer.id }, status: "PENDING" },
      data: { status: "REJECTED" },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /api/jobs/:jobId/milestones/:index/deliverables
jobsRouter.post(
  "/:jobId/milestones/:index/deliverables",
  requireAuth,
  validate(createDeliverableSchema),
  async (req, res, next) => {
    try {
      const milestoneIndex = parseInt(req.params.index, 10);
      if (isNaN(milestoneIndex)) throw new AppError(400, "Invalid milestone index");

      const job = await prisma.job.findUnique({
        where: { id: req.params.jobId },
        include: { freelancer: true },
      });
      if (!job) throw new AppError(404, "Job not found");

      if (job.freelancer?.stellarAddress !== res.locals.stellarAddress) {
        throw new AppError(403, "Only the assigned freelancer can attach deliverables to this milestone");
      }

      const milestone = await prisma.milestone.findFirst({
        where: { jobId: job.id, index: milestoneIndex },
      });
      if (!milestone) throw new AppError(404, "Milestone not found");

      if (milestone.status === "RELEASED") {
        throw new AppError(400, "Cannot attach deliverables to an already released milestone");
      }

      const user = await prisma.user.upsert({
        where: { stellarAddress: res.locals.stellarAddress },
        create: { stellarAddress: res.locals.stellarAddress },
        update: {},
      });

      const { fileName, fileUrl, fileSize, fileType, description } = req.body as {
        fileName: string;
        fileUrl: string;
        fileSize?: number;
        fileType?: string;
        description?: string;
      };

      const deliverable = await prisma.deliverable.create({
        data: {
          milestoneId: milestone.id,
          fileName,
          fileUrl,
          fileSize,
          fileType,
          description,
          uploadedById: user.id,
        },
        include: { uploadedBy: true },
      });

      res.status(201).json(deliverable);
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/jobs/:jobId/milestones/:index/deliverables
jobsRouter.get("/:jobId/milestones/:index/deliverables", async (req, res, next) => {
  try {
    const milestoneIndex = parseInt(req.params.index, 10);
    if (isNaN(milestoneIndex)) throw new AppError(400, "Invalid milestone index");

    const milestone = await prisma.milestone.findFirst({
      where: { jobId: req.params.jobId, index: milestoneIndex },
    });
    if (!milestone) throw new AppError(404, "Milestone not found");

    const deliverables = await prisma.deliverable.findMany({
      where: { milestoneId: milestone.id },
      include: { uploadedBy: true },
      orderBy: { createdAt: "desc" },
    });

    res.json(deliverables);
  } catch (err) {
    next(err);
  }
});


/**
 * reputation.ts
 *
 * POST /api/reputation               — submit a rating (builds reputation.submit tx)
 * GET  /api/reputation/:address      — get aggregate score for an address
 * GET  /api/reputation/:address/ratings — list the individual ratings received
 */

import { Router } from "express";
import { z } from "zod";
import {
  Contract,
  Networks,
  SorobanRpc,
  TransactionBuilder,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { Prisma } from "@prisma/client";
import { config } from "../config";
import { buildReputationSubmitArgs } from "../lib/scval";
import { isValidStellarAddress } from "../lib/stellarAddress";
import { friendlyContractError, REPUTATION_ERROR_MESSAGES } from "../lib/contractErrors";
import { prisma } from "../db";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { AppError } from "../middleware/errorHandler";

export const reputationRouter = Router();

const server = new SorobanRpc.Server(config.SOROBAN_RPC_URL);
const networkPassphrase =
  config.STELLAR_NETWORK === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;

// POST /api/reputation
const submitSchema = z.object({
  jobId: z.string(),
  rateeAddress: z.string().refine(isValidStellarAddress, "Invalid Stellar address"),
  score: z.number().int().min(1).max(5),
  comment: z.string().max(500).optional(),
});

reputationRouter.post("/", requireAuth, validate(submitSchema), async (req, res, next) => {
  try {
    const { jobId, rateeAddress, score, comment } = req.body as z.infer<typeof submitSchema>;

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: { client: true, freelancer: true },
    });
    if (!job) throw new AppError(404, "Job not found");
    if (job.status !== "COMPLETED") throw new AppError(400, "Job is not completed");
    if (!job.escrowId) throw new AppError(400, "No on-chain escrow for this job");

    const raterAddress = res.locals.stellarAddress;
    const ratee = await prisma.user.findUnique({ where: { stellarAddress: rateeAddress } });
    const rater = await prisma.user.findUnique({ where: { stellarAddress: raterAddress } });
    if (!ratee || !rater) throw new AppError(404, "User not found");

    // Check for a duplicate rating before building anything.
    // The off-chain row mirrors the on-chain state; if it already exists the
    // wallet has already signed and submitted, or a previous attempt persisted
    // a row that was never submitted.  Either way a second attempt is a 409.
    const existingRating = await prisma.rating.findUnique({
      where: { raterId_jobId: { raterId: rater.id, jobId } },
    });
    if (existingRating) {
      throw new AppError(409, "You have already rated this job.");
    }

    // Build reputation.submit tx
    const contract = new Contract(config.REPUTATION_CONTRACT_ID);
    const account = await server.getAccount(raterAddress);
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
      .addOperation(
        contract.call(
          "submit",
          ...buildReputationSubmitArgs(raterAddress, rateeAddress, job.escrowId, score),
        ),
      )
      .setTimeout(30)
      .build();
    const sim = await server.simulateTransaction(tx);
    if ("error" in sim) {
      // Translate the raw HostError into a readable message using the
      // reputation contract's own error table.
      const friendly = friendlyContractError(String(sim.error), REPUTATION_ERROR_MESSAGES);
      throw new AppError(400, `Simulation failed: ${friendly}`);
    }
    const xdr = SorobanRpc.assembleTransaction(tx, sim).build().toXDR();

    // Persist off-chain (on-chain record is source of truth; this is for fast reads).
    // Only create the row after the transaction is successfully built so a row
    // cannot exist without a valid XDR to submit.
    let rating;
    try {
      rating = await prisma.rating.create({
        data: { jobId, raterId: rater.id, rateeId: ratee.id, score, comment },
      });
    } catch (err) {
      // A concurrent duplicate-submit can still hit the unique constraint after
      // the `findUnique` guard above (race condition). Map it to 409 rather than
      // letting it bubble as a 500.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new AppError(409, "You have already rated this job.");
      }
      throw err;
    }

    res.status(201).json({ rating, xdr });
  } catch (err) {
    next(err);
  }
});

// GET /api/reputation/:address/ratings
//
// The aggregate above answers "how good is this address"; a profile that lets a
// client judge a freelancer also needs the history behind it (issue #69). One
// row per rating received, newest first, each joined to the job it came from so
// the client can open the work it refers to.
reputationRouter.get("/:address/ratings", async (req, res, next) => {
  try {
    const ratings = await prisma.rating.findMany({
      where: { ratee: { stellarAddress: req.params.address } },
      include: {
        job: { select: { id: true, title: true, escrowId: true, status: true } },
        rater: { select: { stellarAddress: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json(ratings);
  } catch (err) {
    next(err);
  }
});

// GET /api/reputation/:address
reputationRouter.get("/:address", async (req, res, next) => {
  try {
    const result = await prisma.rating.aggregate({
      where: { ratee: { stellarAddress: req.params.address } },
      _avg: { score: true },
      _count: { score: true },
    });
    res.json({
      address: req.params.address,
      averageScore: result._avg.score ?? 0,
      totalRatings: result._count.score,
    });
  } catch (err) {
    next(err);
  }
});

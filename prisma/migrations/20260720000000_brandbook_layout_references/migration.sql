-- AlterTable
ALTER TABLE "brand_books" ADD COLUMN "layout" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "brand_books" ADD COLUMN "referenceImages" JSONB NOT NULL DEFAULT '[]';

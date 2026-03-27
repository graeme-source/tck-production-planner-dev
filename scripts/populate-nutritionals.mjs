import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const KNOWN_INGREDIENTS = {
  "Salt": {
    label: "Salt",
    energyKj: 0, energyKcal: 0, fat: 0, saturates: 0, carbohydrate: 0, sugars: 0, protein: 0, fibre: 0, salt: 99.8
  },
  "Olive Oil": {
    label: "Olive Oil",
    energyKj: 3701, energyKcal: 884, fat: 100, saturates: 14.2, carbohydrate: 0, sugars: 0, protein: 0, fibre: 0, salt: 0
  },
  "Flour (00)": {
    label: "Wheat Flour (Type 00)",
    energyKj: 1468, energyKcal: 348, fat: 1.2, saturates: 0.2, carbohydrate: 73.3, sugars: 1.7, protein: 11.5, fibre: 2.7, salt: 0
  },
  "Yeast": {
    label: "Yeast",
    energyKj: 1296, energyKcal: 310, fat: 4, saturates: 0.6, carbohydrate: 41.2, sugars: 0, protein: 40.4, fibre: 26.9, salt: 0.12
  },
  "Tap Water": {
    label: "Water",
    energyKj: 0, energyKcal: 0, fat: 0, saturates: 0, carbohydrate: 0, sugars: 0, protein: 0, fibre: 0, salt: 0
  },
  "Mozzarella": {
    label: "Mozzarella Cheese (Milk)",
    energyKj: 1132, energyKcal: 271, fat: 17.7, saturates: 11.1, carbohydrate: 3.1, sugars: 1.4, protein: 25.3, fibre: 0, salt: 0.63
  },
  "Fior Di Latte": {
    label: "Fior Di Latte Cheese (Milk)",
    energyKj: 1132, energyKcal: 271, fat: 17.7, saturates: 11.1, carbohydrate: 3.1, sugars: 1.4, protein: 25.3, fibre: 0, salt: 0.63
  },
  "Matture Cheddar": {
    label: "Mature Cheddar Cheese (Milk)",
    energyKj: 1725, energyKcal: 416, fat: 34.9, saturates: 21.7, carbohydrate: 0.1, sugars: 0.1, protein: 25.4, fibre: 0, salt: 1.8
  },
  "Feta": {
    label: "Feta Cheese (Milk)",
    energyKj: 1103, energyKcal: 264, fat: 21.3, saturates: 14.9, carbohydrate: 1.5, sugars: 1.5, protein: 17.2, fibre: 0, salt: 2.5
  },
  "Pepperoni": {
    label: "Pepperoni (Pork, Spices, Salt, Dextrose, Garlic Powder, Smoke Flavouring)",
    energyKj: 1979, energyKcal: 476, fat: 40.2, saturates: 14.8, carbohydrate: 3.1, sugars: 1.1, protein: 24.8, fibre: 0, salt: 3.6
  },
  "Chorizo": {
    label: "Chorizo (Pork, Paprika, Garlic, Salt, Spices)",
    energyKj: 1815, energyKcal: 437, fat: 38.3, saturates: 14.3, carbohydrate: 1.9, sugars: 1.8, protein: 21.8, fibre: 0.9, salt: 3.3
  },
  "Pork": {
    label: "Pork",
    energyKj: 519, energyKcal: 123, fat: 4.0, saturates: 1.4, carbohydrate: 0, sugars: 0, protein: 21.2, fibre: 0, salt: 0.16
  },
  "Duck": {
    label: "Duck",
    energyKj: 769, energyKcal: 184, fat: 10.0, saturates: 3.5, carbohydrate: 0, sugars: 0, protein: 23.5, fibre: 0, salt: 0.15
  },
  "Diced Chicken fillet": {
    label: "Chicken Breast",
    energyKj: 460, energyKcal: 110, fat: 1.3, saturates: 0.3, carbohydrate: 0, sugars: 0, protein: 23.1, fibre: 0, salt: 0.15
  },
  "Minced Beef": {
    label: "Minced Beef",
    energyKj: 893, energyKcal: 214, fat: 15.2, saturates: 6.3, carbohydrate: 0, sugars: 0, protein: 19.3, fibre: 0, salt: 0.18
  },
  "Burger Meat": {
    label: "Beef",
    energyKj: 893, energyKcal: 214, fat: 15.2, saturates: 6.3, carbohydrate: 0, sugars: 0, protein: 19.3, fibre: 0, salt: 0.18
  },
  "Beef Burgers": {
    label: "Beef Burger (Beef, Seasoning, Salt)",
    energyKj: 1050, energyKcal: 252, fat: 17.3, saturates: 7.2, carbohydrate: 4.8, sugars: 0.5, protein: 19.5, fibre: 0.5, salt: 1.2
  },
  "Salted Butter": {
    label: "Salted Butter (Milk)",
    energyKj: 3059, energyKcal: 744, fat: 82.2, saturates: 52.1, carbohydrate: 0.6, sugars: 0.6, protein: 0.6, fibre: 0, salt: 1.5
  },
  "Red Onions": {
    label: "Red Onion",
    energyKj: 163, energyKcal: 39, fat: 0.1, saturates: 0, carbohydrate: 7.9, sugars: 5.6, protein: 1.2, fibre: 1.7, salt: 0.01
  },
  "Red peppers": {
    label: "Red Pepper",
    energyKj: 130, energyKcal: 31, fat: 0.3, saturates: 0, carbohydrate: 6.0, sugars: 4.2, protein: 1.0, fibre: 2.1, salt: 0.01
  },
  "Mushrooms": {
    label: "Mushrooms",
    energyKj: 55, energyKcal: 13, fat: 0.5, saturates: 0.1, carbohydrate: 0.4, sugars: 0.2, protein: 1.8, fibre: 1.0, salt: 0.02
  },
  "Spring Onions": {
    label: "Spring Onion",
    energyKj: 138, energyKcal: 33, fat: 0.2, saturates: 0, carbohydrate: 5.7, sugars: 2.8, protein: 1.8, fibre: 2.6, salt: 0.04
  },
  "Courgettes": {
    label: "Courgette",
    energyKj: 71, energyKcal: 17, fat: 0.3, saturates: 0.1, carbohydrate: 1.8, sugars: 1.7, protein: 1.2, fibre: 1.0, salt: 0.02
  },
  "Basil": {
    label: "Basil",
    energyKj: 96, energyKcal: 23, fat: 0.6, saturates: 0, carbohydrate: 1.3, sugars: 0.3, protein: 3.2, fibre: 1.6, salt: 0.01
  },
  "Rosemary": {
    label: "Rosemary",
    energyKj: 544, energyKcal: 131, fat: 5.9, saturates: 2.6, carbohydrate: 6.6, sugars: 0, protein: 3.3, fibre: 14.1, salt: 0.06
  },
  "Red Chillis": {
    label: "Red Chilli",
    energyKj: 167, energyKcal: 40, fat: 0.4, saturates: 0.1, carbohydrate: 6.1, sugars: 3.4, protein: 1.9, fibre: 1.5, salt: 0.02
  },
  "Gherkin (drained weight)": {
    label: "Gherkin",
    energyKj: 67, energyKcal: 16, fat: 0.1, saturates: 0, carbohydrate: 2.0, sugars: 1.1, protein: 0.5, fibre: 1.0, salt: 1.6
  },
  "Garlic Cloves fresh peeled": {
    label: "Garlic",
    energyKj: 620, energyKcal: 149, fat: 0.5, saturates: 0.1, carbohydrate: 29.3, sugars: 1.0, protein: 6.4, fibre: 2.1, salt: 0.04
  },
  "Garlic Granules": {
    label: "Garlic Granules",
    energyKj: 1389, energyKcal: 331, fat: 0.7, saturates: 0.1, carbohydrate: 72.7, sugars: 2.4, protein: 16.6, fibre: 9.0, salt: 0.08
  },
  "Garlic Powder": {
    label: "Garlic Powder",
    energyKj: 1389, energyKcal: 331, fat: 0.7, saturates: 0.1, carbohydrate: 72.7, sugars: 2.4, protein: 16.6, fibre: 9.0, salt: 0.08
  },
  "Onion Powder": {
    label: "Onion Powder",
    energyKj: 1431, energyKcal: 341, fat: 1.0, saturates: 0.2, carbohydrate: 79.1, sugars: 6.6, protein: 10.4, fibre: 15.2, salt: 0.08
  },
  "Paprika": {
    label: "Paprika",
    energyKj: 1172, energyKcal: 282, fat: 12.9, saturates: 2.1, carbohydrate: 34.8, sugars: 10.3, protein: 14.1, fibre: 34.9, salt: 0.08
  },
  "Smoked paprika": {
    label: "Smoked Paprika",
    energyKj: 1172, energyKcal: 282, fat: 12.9, saturates: 2.1, carbohydrate: 34.8, sugars: 10.3, protein: 14.1, fibre: 34.9, salt: 0.08
  },
  "Chilli powder": {
    label: "Chilli Powder",
    energyKj: 1172, energyKcal: 282, fat: 14.3, saturates: 2.5, carbohydrate: 29.3, sugars: 7.2, protein: 13.5, fibre: 34.8, salt: 0.77
  },
  "Ground Cumin": {
    label: "Ground Cumin",
    energyKj: 1567, energyKcal: 375, fat: 22.3, saturates: 1.5, carbohydrate: 33.7, sugars: 2.3, protein: 17.8, fibre: 10.5, salt: 0.17
  },
  "Ground black pepper": {
    label: "Black Pepper",
    energyKj: 1059, energyKcal: 255, fat: 3.3, saturates: 1.4, carbohydrate: 38.3, sugars: 0.6, protein: 10.4, fibre: 25.3, salt: 0.05
  },
  "Course Black Pepper": {
    label: "Cracked Black Pepper",
    energyKj: 1059, energyKcal: 255, fat: 3.3, saturates: 1.4, carbohydrate: 38.3, sugars: 0.6, protein: 10.4, fibre: 25.3, salt: 0.05
  },
  "Oregano": {
    label: "Oregano",
    energyKj: 1087, energyKcal: 265, fat: 4.3, saturates: 1.6, carbohydrate: 26.0, sugars: 4.1, protein: 9.0, fibre: 42.5, salt: 0.06
  },
  "Dried Parsley": {
    label: "Dried Parsley",
    energyKj: 1132, energyKcal: 271, fat: 5.5, saturates: 1.0, carbohydrate: 28.6, sugars: 7.3, protein: 26.6, fibre: 26.7, salt: 0.45
  },
  "Dried Thyme": {
    label: "Dried Thyme",
    energyKj: 1138, energyKcal: 276, fat: 7.4, saturates: 2.7, carbohydrate: 26.9, sugars: 1.7, protein: 9.1, fibre: 37.0, salt: 0.06
  },
  "Demerrera Sugar": {
    label: "Demerara Sugar",
    energyKj: 1630, energyKcal: 389, fat: 0, saturates: 0, carbohydrate: 97.3, sugars: 97.3, protein: 0, fibre: 0, salt: 0.01
  },
  "Passata (Rodolfi)": {
    label: "Tomato Passata (Tomatoes)",
    energyKj: 109, energyKcal: 26, fat: 0.1, saturates: 0, carbohydrate: 4.3, sugars: 3.8, protein: 1.3, fibre: 1.0, salt: 0.04
  },
  "Tomato Puree (paste)": {
    label: "Tomato Purée (Tomatoes)",
    energyKj: 347, energyKcal: 82, fat: 0.4, saturates: 0.1, carbohydrate: 13.1, sugars: 11.5, protein: 4.3, fibre: 4.1, salt: 0.17
  },
  "Honey (CR)": {
    label: "Honey",
    energyKj: 1381, energyKcal: 329, fat: 0, saturates: 0, carbohydrate: 81.5, sugars: 81.5, protein: 0.3, fibre: 0, salt: 0.01
  },
  "Balsamic Glaze": {
    label: "Balsamic Glaze (Balsamic Vinegar of Modena (Wine Vinegar, Grape Must), Glucose-Fructose Syrup)",
    energyKj: 754, energyKcal: 178, fat: 0, saturates: 0, carbohydrate: 43.0, sugars: 38.0, protein: 0.5, fibre: 0, salt: 0.08
  },
  "Pastrami (Sliced)": {
    label: "Pastrami (Beef, Salt, Sugar, Spices, Smoke Flavouring)",
    energyKj: 560, energyKcal: 133, fat: 4.8, saturates: 1.6, carbohydrate: 2.0, sugars: 1.8, protein: 21.0, fibre: 0, salt: 2.5
  },
  "Streky Bacon": {
    label: "Streaky Bacon (Pork Belly, Salt, Sugar, Preservative: Sodium Nitrite)",
    energyKj: 1156, energyKcal: 278, fat: 22.3, saturates: 8.2, carbohydrate: 0.5, sugars: 0.5, protein: 18.5, fibre: 0, salt: 2.9
  },
};

const LABEL_ONLY = {
  "BBQ Sauce (lion sticky)": "BBQ Sauce (Sugar, Tomato Purée, Spirit Vinegar, Molasses, Modified Maize Starch, Salt, Mustard Flour, Spices, Garlic Powder, Smoke Flavouring)",
  "American Mustard": "American Mustard (Water, Spirit Vinegar, Mustard Seed, Salt, Turmeric, Paprika, Garlic Powder)",
  "Burger Sauce": "Burger Sauce",
  "Brakes Chilli Jam": "Chilli Jam",
  "Red Onion Chutney": "Red Onion Chutney",
  "Hoisin Sauce": "Hoisin Sauce (Water, Sugar, Soya Beans, Modified Corn Starch, Salt, Sesame Oil, Garlic, Chilli, Spices)",
  "Piri Piri Glaze (MRC)": "Piri Piri Glaze",
  "Calzone Dough": "Calzone Dough",
  "Chicken Seasoning Mix": "Chicken Seasoning Mix",
  "Cheeky Gluten Free Crispy Fried Onions": "Crispy Fried Onions (Onion, Palm Oil, Rice Flour, Salt)",
  "Sysco Classic Grated Monterey Jack Cheese": "Monterey Jack Cheese (Milk, Salt, Cultures, Enzyme)",
};

async function main() {
  const client = await pool.connect();
  try {
    const { rows: ingredients } = await client.query(
      `SELECT id, name, label_declaration, energy_kcal FROM ingredients ORDER BY name`
    );

    let updated = 0;
    let labelOnly = 0;
    let skipped = 0;
    const report = [];

    for (const ing of ingredients) {
      const known = KNOWN_INGREDIENTS[ing.name];
      if (known) {
        await client.query(
          `UPDATE ingredients SET
            label_declaration = $1,
            energy_kj = $2, energy_kcal = $3, fat = $4, saturates = $5,
            carbohydrate = $6, sugars = $7, protein = $8, fibre = $9, salt = $10
          WHERE id = $11`,
          [known.label, known.energyKj, known.energyKcal, known.fat, known.saturates,
           known.carbohydrate, known.sugars, known.protein, known.fibre, known.salt, ing.id]
        );
        report.push({ name: ing.name, status: "UPDATED", label: known.label });
        updated++;
        continue;
      }

      const labelOnlyVal = LABEL_ONLY[ing.name];
      if (labelOnlyVal) {
        await client.query(
          `UPDATE ingredients SET label_declaration = $1 WHERE id = $2`,
          [labelOnlyVal, ing.id]
        );
        report.push({ name: ing.name, status: "LABEL_ONLY", label: labelOnlyVal, note: "Nutritionals need manual entry (branded/composite product)" });
        labelOnly++;
        continue;
      }

      report.push({ name: ing.name, status: "SKIPPED", note: "No match — needs manual data entry" });
      skipped++;
    }

    console.log("\n=== POPULATION REPORT ===\n");
    console.log(`Total ingredients: ${ingredients.length}`);
    console.log(`Updated (nutritionals + label): ${updated}`);
    console.log(`Label declaration only: ${labelOnly}`);
    console.log(`Skipped (needs manual review): ${skipped}`);
    console.log("\n--- UPDATED (nutritionals + label declaration) ---");
    report.filter(r => r.status === "UPDATED").forEach(r => console.log(`  ✓ ${r.name} → "${r.label}"`));
    console.log("\n--- LABEL DECLARATION ONLY (nutritionals need manual entry) ---");
    report.filter(r => r.status === "LABEL_ONLY").forEach(r => console.log(`  ◐ ${r.name} → "${r.label}" — ${r.note}`));
    console.log("\n--- SKIPPED (needs full manual entry) ---");
    report.filter(r => r.status === "SKIPPED").forEach(r => console.log(`  ✗ ${r.name} — ${r.note}`));

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });

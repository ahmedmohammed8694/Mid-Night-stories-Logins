import sqlite3
import json
import os

DB_PATH = r"d:\My Applications\Midnigth stories\data\stories.db"
OUTPUT_JSON = r"d:\My Applications\Midnigth stories\scratch\categorization_result.json"

def main():
    print("🚀 Starting book analysis, classification, and database integration...")
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # 1. Ensure Sci-Fi and Fantasy categories exist under 'naval' channel for Novel/Story books
    cursor.execute("INSERT OR IGNORE INTO categories (name, slug, channel_type) VALUES ('Sci-Fi Novel', 'sci-fi-novel', 'naval')")
    cursor.execute("INSERT OR IGNORE INTO categories (name, slug, channel_type) VALUES ('Fantasy Novel', 'fantasy-novel', 'naval')")
    conn.commit()
    
    # Fetch category IDs
    cursor.execute("SELECT id, name, slug, channel_type FROM categories")
    categories_map = {f"{row[2]}:{row[3]}": row[0] for row in cursor.fetchall()}
    
    # Get all books
    cursor.execute("SELECT id, title, author, description, file_url FROM books")
    books = cursor.fetchall()
    
    categorization_results = []
    updated_count = 0
    
    for book in books:
        b_id, title, author, description, file_url = book
        desc = description.lower() if description else ""
        title_lower = title.lower()
        
        # Classification Logic
        primary_class = "Novel / Story"
        channel_type = "naval"
        sub_category = "Sci-Fi Novel"
        sub_category_slug = "sci-fi-novel"
        
        # Identify Harry Potter (Fantasy)
        if "j. k. rowling" in author.lower() or "j.k. rowling" in author.lower() or "harry potter" in title_lower:
            primary_class = "Novel / Story"
            channel_type = "naval"
            sub_category = "Fantasy Novel"
            sub_category_slug = "fantasy-novel"
            
        # Identify Warhammer (Sci-Fi)
        elif any(x in title_lower or x in desc for x in ["warhammer", "daemon", "horus heresy", "space marine", "mechanicus", "void"]):
            primary_class = "Novel / Story"
            channel_type = "naval"
            sub_category = "Sci-Fi Novel"
            sub_category_slug = "sci-fi-novel"
            
        # Identify Educational / Textbooks / Academic
        elif any(x in title_lower or x in desc for x in ["mathematics", "computer science", "engineering", "resume", "cert", "course", "guide"]):
            primary_class = "Educational"
            channel_type = "education"
            sub_category = "Academic References"
            sub_category_slug = "academic-references"
            if "computer" in title_lower:
                sub_category = "Computer Science"
                sub_category_slug = "computer-science"
            elif "mathematics" in title_lower:
                sub_category = "Mathematics"
                sub_category_slug = "mathematics"
                
        # Fallback Sci-Fi Novel since Warhammer dominates
        else:
            primary_class = "Novel / Story"
            channel_type = "naval"
            sub_category = "Sci-Fi Novel"
            sub_category_slug = "sci-fi-novel"
            
        # Get target Category ID
        cat_key = f"{sub_category_slug}:{channel_type}"
        target_cat_id = categories_map.get(cat_key, categories_map.get("sci-fi-novel:naval", 1))
        
        # Update database book entry channel_type
        cursor.execute("UPDATE books SET channel_type = ? WHERE id = ?", (channel_type, b_id))
        
        # Update book category mapping
        cursor.execute("DELETE FROM book_categories WHERE book_id = ?", (b_id,))
        cursor.execute("INSERT INTO book_categories (book_id, category_id) VALUES (?, ?)", (b_id, target_cat_id))
        
        categorization_results.append({
            "book_id": b_id,
            "title": title,
            "author": author,
            "primary_classification": primary_class,
            "channel_type": channel_type,
            "sub_category": sub_category,
            "sub_category_slug": sub_category_slug
        })
        updated_count += 1
        
    conn.commit()
    conn.close()
    
    # Save JSON Output
    os.makedirs(os.path.dirname(OUTPUT_JSON), exist_ok=True)
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(categorization_results, f, indent=2)
        
    print(f"🎉 Analysis Complete! Categorized {updated_count} books and updated database maps.")

if __name__ == "__main__":
    main()
